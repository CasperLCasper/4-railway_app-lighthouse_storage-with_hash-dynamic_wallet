import { requireAuth } from "../_lib/auth.js";
import { checkRateLimit } from "../_lib/rateLimit.js";
import crypto from 'crypto';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'video/mp4', 'video/webm'];
const MAX_SIZE = 50 * 1024 * 1024;

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const user = await requireAuth(request, env);
    if (user instanceof Response) return user;
    if (!user || !user.address) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { "Content-Type": "application/json" }
      });
    }

    const rateKey = `prepare-nft:${user.address.toLowerCase()}`;
    if (!(await checkRateLimit({ key: rateKey, limit: 5, windowMs: 60000 }, env))) {
      return new Response(JSON.stringify({ error: 'Too many requests. Try again later.' }), {
        status: 429, headers: { "Content-Type": "application/json" }
      });
    }

    let formData;
    try {
      formData = await request.formData();
    } catch (e) {
      return new Response(JSON.stringify({ error: "Invalid form data" }), {
        status: 400, headers: { "Content-Type": "application/json" }
      });
    }

    const imageFile = formData.get('image');
    const videoFile = formData.get('video');

    if (!imageFile || !(imageFile instanceof globalThis.File)) {
      return new Response(JSON.stringify({ error: 'No image file provided' }), {
        status: 400, headers: { "Content-Type": "application/json" }
      });
    }

    if (!ALLOWED_TYPES.includes(imageFile.type)) {
      return new Response(JSON.stringify({ error: `Image type not allowed: ${imageFile.type}` }), {
        status: 400, headers: { "Content-Type": "application/json" }
      });
    }
    if (imageFile.size > MAX_SIZE) {
      return new Response(JSON.stringify({ error: 'Image too large. Max 50MB' }), {
        status: 400, headers: { "Content-Type": "application/json" }
      });
    }

    if (videoFile) {
      if (!ALLOWED_TYPES.includes(videoFile.type)) {
        return new Response(JSON.stringify({ error: `Video type not allowed: ${videoFile.type}` }), {
          status: 400, headers: { "Content-Type": "application/json" }
        });
      }
      if (videoFile.size > MAX_SIZE) {
        return new Response(JSON.stringify({ error: 'Video too large. Max 50MB' }), {
          status: 400, headers: { "Content-Type": "application/json" }
        });
      }
    }

    console.log(`🚀 Apstrādājam NFT failus lietotājam ${user.address}...`);

    const imageArrayBuffer = await imageFile.arrayBuffer();
    const imageBuffer = Buffer.from(imageArrayBuffer);
    
    let videoBuffer = null;
    let videoMimeType = null;
    let videoFileName = null;
    
    if (videoFile) {
      const videoArrayBuffer = await videoFile.arrayBuffer();
      videoBuffer = Buffer.from(videoArrayBuffer);
      videoMimeType = videoFile.type;
      videoFileName = videoFile.name;
    }

    // Aprēķinam hash
    const imageHash = '0x' + crypto.createHash('sha256').update(imageBuffer).digest('hex');
    console.log('🔐 Image Hash:', imageHash);

    let videoHash = null;
    if (videoBuffer) {
      videoHash = '0x' + crypto.createHash('sha256').update(videoBuffer).digest('hex');
      console.log('🔐 Video Hash:', videoHash);
    }

    // Mēģinam augšupielādēt uz Lighthouse
    let imageCid = null;
    let videoCid = null;
    let lighthouseError = null;

    if (env.LIGHTHOUSE_API_KEY) {
      try {
        console.log('📤 Mēģinam augšupielādēt attēlu uz Lighthouse...');
        
        const imageFormData = new FormData();
        imageFormData.append('file', new globalThis.File([imageBuffer], imageFile.name, { type: imageFile.type }));

        const imageResponse = await fetch('https://api.lighthouse.storage/api/v0/upload', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.LIGHTHOUSE_API_KEY}`,
            'X-Storage-Type': 'annual'
          },
          body: imageFormData
        });

        if (imageResponse.ok) {
          const imageResult = await imageResponse.json();
          imageCid = imageResult?.data?.Hash || imageResult?.Hash;
          if (imageCid) console.log('✅ Attēls augšupielādēts Lighthouse:', imageCid);
        } else {
          console.warn('⚠️ Lighthouse attēla augšupielāde neizdevās:', imageResponse.status);
          lighthouseError = `HTTP ${imageResponse.status}`;
        }
      } catch (error) {
        console.warn('⚠️ Lighthouse attēla augšupielādes kļūda:', error.message);
        lighthouseError = error.message;
      }

      if (videoBuffer) {
        try {
          console.log('📤 Mēģinam augšupielādēt video uz Lighthouse...');
          
          const videoFormData = new FormData();
          videoFormData.append('file', new globalThis.File([videoBuffer], videoFileName, { type: videoMimeType }));

          const videoResponse = await fetch('https://api.lighthouse.storage/api/v0/upload', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${env.LIGHTHOUSE_API_KEY}`,
              'X-Storage-Type': 'annual'
            },
            body: videoFormData
          });

          if (videoResponse.ok) {
            const videoResult = await videoResponse.json();
            videoCid = videoResult?.data?.Hash || videoResult?.Hash;
            if (videoCid) console.log('✅ Video augšupielādēts Lighthouse:', videoCid);
          } else {
            console.warn('⚠️ Lighthouse video augšupielāde neizdevās:', videoResponse.status);
          }
        } catch (error) {
          console.warn('⚠️ Lighthouse video augšupielādes kļūda:', error.message);
        }
      }
    } else {
      lighthouseError = 'No API key configured';
      console.warn('⚠️ LIGHTHOUSE_API_KEY nav konfigurēts');
    }

    const responseData = {
      success: true,
      image: {
        hash: imageHash,
        cid: imageCid || null,
        fileName: imageFile.name,
        mimeType: imageFile.type,
        size: imageFile.size
      },
      video: videoBuffer ? {
        hash: videoHash,
        cid: videoCid || null,
        fileName: videoFileName,
        mimeType: videoMimeType,
        size: videoFile.size
      } : null,
      lighthouse: {
        success: !!(imageCid || videoCid),
        error: lighthouseError
      }
    };

    console.log(`✅ NFT sagatavošana pabeigta! Image hash: ${imageHash}`);

    return new Response(JSON.stringify(responseData), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch (error) {
    console.error('💥 prepare-nft kļūda:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
