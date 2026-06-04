import { requireAuth } from "../_lib/auth.js";
import { checkRateLimit } from "../_lib/rateLimit.js";
import crypto from 'crypto';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'video/mp4', 'video/webm'];
const MAX_SIZE = 50 * 1024 * 1024; // 50MB

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const user = await requireAuth(request, env);
    if (user instanceof Response) return user;
    if (!user || !user.address) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" }
      });
    }

    const rateKey = `upload-file:${user.address.toLowerCase()}`;
    if (!(await checkRateLimit({ key: rateKey, limit: 5, windowMs: 60000 }, env))) {
      return new Response(JSON.stringify({ error: 'Too many file uploads. Try again later.' }), {
        status: 429,
        headers: { "Content-Type": "application/json" }
      });
    }

    let formData;
    try {
      formData = await request.formData();
    } catch (e) {
      return new Response(JSON.stringify({ error: "Invalid form data" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    const fileEntry = formData.get('file');
    if (!fileEntry || !(fileEntry instanceof File)) {
      return new Response(JSON.stringify({ error: 'No file found under key "file"' }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    const contentType = fileEntry.type;
    const fileSize = fileEntry.size;
    if (!ALLOWED_TYPES.includes(contentType)) {
      return new Response(JSON.stringify({ error: `File type not allowed: ${contentType}` }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }
    if (fileSize > MAX_SIZE) {
      return new Response(JSON.stringify({ error: `File too large. Max 50MB` }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    console.log(`🚀 Augšupielādējam failu uz Lighthouse API (Annual Storage)...`);

    const arrayBuffer = await fileEntry.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 🔐 Aprēķina SHA256 hash no faila baitiem
    const fileHash = '0x' + crypto.createHash('sha256').update(buffer).digest('hex');

    const customFormData = new FormData();
    customFormData.append('file', new Blob([buffer], { type: contentType }), fileEntry.name);

    const response = await fetch('https://api.lighthouse.storage/api/v0/upload', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.LIGHTHOUSE_API_KEY}`,
        'X-Storage-Type': 'annual'
      },
      body: customFormData
    });

    const result = await response.json();
    
    if (!response.ok) {
      console.error("Lighthouse API kļūda:", result);
      throw new Error(`Lighthouse API error: ${response.status}`);
    }

    const cid = result?.data?.Hash || result?.Hash;

    if (!cid) {
      console.error("Lighthouse API atbilde:", JSON.stringify(result));
      throw new Error("Neizdevās iegūt CID no Lighthouse API");
    }

    console.log(`✅ Fails veiksmīgi augšupielādēts! CID: ${cid}, Hash: ${fileHash}`);

    return new Response(JSON.stringify({
      ipfs: `ipfs://${cid}`,
      http: `https://meaningful-macaw-y3g2r.lighthouseweb3.xyz/ipfs/${cid}`,
      cid: cid,
      hash: fileHash
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch (error) {
    console.error('💥 Lighthouse kļūda:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
