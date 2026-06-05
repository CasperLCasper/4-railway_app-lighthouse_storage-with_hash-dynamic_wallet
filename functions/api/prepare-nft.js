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

    if (!imageFile) {
      return new Response(JSON.stringify({ error: 'No image file provided' }), {
        status: 400, headers: { "Content-Type": "application/json" }
      });
    }

    const imageArrayBuffer = await imageFile.arrayBuffer();
    const imageBuffer = Buffer.from(imageArrayBuffer);
    const imageType = imageFile.type || 'image/png';
    const imageName = imageFile.name || 'snapshot.png';
    const imageSize = imageFile.size;

    if (!ALLOWED_TYPES.includes(imageType)) {
      return new Response(JSON.stringify({ error: `Image type not allowed: ${imageType}` }), {
        status: 400, headers: { "Content-Type": "application/json" }
      });
    }
    if (imageSize > MAX_SIZE) {
      return new Response(JSON.stringify({ error: 'Image too large. Max 50MB' }), {
        status: 400, headers: { "Content-Type": "application/json" }
      });
    }

    let videoBuffer = null;
    let videoType = null;
    let videoName = null;
    let videoSize = null;

    if (videoFile) {
      const videoArrayBuffer = await videoFile.arrayBuffer();
      videoBuffer = Buffer.from(videoArrayBuffer);
      videoType = videoFile.type || 'video/webm';
      videoName = videoFile.name || 'video.webm';
      videoSize = videoFile.size;

      if (!ALLOWED_TYPES.includes(videoType)) {
        return new Response(JSON.stringify({ error: `Video type not allowed: ${videoType}` }), {
          status: 400, headers: { "Content-Type": "application/json" }
        });
      }
      if (videoSize > MAX_SIZE) {
        return new Response(JSON.stringify({ error: 'Video too large. Max 50MB' }), {
          status: 400, headers: { "Content-Type": "application/json" }
        });
      }
    }

    console.log(`🚀 Apstrādājam NFT failus lietotājam ${user.address}...`);

    const imageHash = '0x' + crypto.createHash('sha256').update(imageBuffer).digest('hex');
    console.log('🔐 Image Hash:', imageHash);

    let videoHash = null;
    if (videoBuffer) {
      videoHash = '0x' + crypto.createHash('sha256').update(videoBuffer).digest('hex');
      console.log('🔐 Video Hash:', videoHash);
    }

    let imageCid = null;
    let videoCid = null;
    let lighthouseError = null;

    if (env.LIGHTHOUSE_API_KEY) {
      try {
        console.log('📤 Mēģinam augšupielādēt attēlu uz Lighthouse...');
        
        const imageBlob = new Blob([imageBuffer], { type: imageType });
        const lighthouseForm = new FormData();
        lighthouseForm.append('file', imageBlob, imageName);

        const imageResponse = await fetch('https://api.lighthouse.storage/api/v0/upload', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.LIGHTHOUSE_API_KEY}`
          },
          body: lighthouseForm
        });

        const responseText = await imageResponse.text();
        console.log('Lighthouse attēla atbilde:', imageResponse.status, responseText.substring(0, 200));

        if (imageResponse.ok) {
          try {
            const imageResult = JSON.parse(responseText);
            imageCid = imageResult?.data?.Hash || imageResult?.Hash;
            if (imageCid) console.log('✅ Attēls augšupielādēts Lighthouse:', imageCid);
          } catch (parseErr) {
            console.warn('⚠️ Neizdevās parsēt Lighthouse atbildi:', parseErr.message);
          }
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
          
          const videoBlob = new Blob([videoBuffer], { type: videoType });
          const videoLighthouseForm = new FormData();
          videoLighthouseForm.append('file', videoBlob, videoName);

          const videoResponse = await fetch('https://api.lighthouse.storage/api/v0/upload', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${env.LIGHTHOUSE_API_KEY}`
            },
            body: videoLighthouseForm
          });

          const videoResponseText = await videoResponse.text();
          console.log('Lighthouse video atbilde:', videoResponse.status, videoResponseText.substring(0, 200));

          if (videoResponse.ok) {
            try {
              const videoResult = JSON.parse(videoResponseText);
              videoCid = videoResult?.data?.Hash || videoResult?.Hash;
              if (videoCid) console.log('✅ Video augšupielādēts Lighthouse:', videoCid);
            } catch (parseErr) {
              console.warn('⚠️ Neizdevās parsēt Lighthouse video atbildi:', parseErr.message);
            }
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
        fileName: imageName,
        mimeType: imageType,
        size: imageSize
      },
      video: videoBuffer ? {
        hash: videoHash,
        cid: videoCid || null,
        fileName: videoName,
        mimeType: videoType,
        size: videoSize
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
