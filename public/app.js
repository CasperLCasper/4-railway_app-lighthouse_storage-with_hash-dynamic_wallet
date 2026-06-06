// ============================================ //
// MAIN APP - MULTICHAIN WALLET VISUALIZER
// ============================================ //

import { AppState, initUI, UI } from './modules/state.js';
import { VIZ_CHAINS, MINT_CHAIN } from './modules/chains.js';
import { LIGHTHOUSE_GATEWAY, CONTRACT_ABI, LOW_POWER_MODE } from './modules/config.js';
import { showToast, setButtonLoading, updateTokenListUI, hideProgress, showProgress } from './modules/ui.js';
import { login, getNFTPrice, getContractAddress } from './modules/api.js';
import { connectWallet, updateChainStatus, switchToMintChain, switchToVizChain } from './modules/web3.js';
import { 
  uploadImageToIPFS, uploadVideoToIPFS, uploadMetadataToIPFS, 
  showIPFSPreview, downloadFile, downloadAllFiles, calculateHashFromBlob 
} from './modules/ipfs.js';
import { startRecording, cleanupRecording } from './modules/recording.js';
import { getCanvasDimensions, resizeCanvas, cleanup, drawFrame, animate, stopAnimation, renderSnapshot, updateNFTCenters, initParticlesOnce, cloneParticles, hashStringToInt, seededRandomFloat, createParticleCache } from './modules/visualizer.js';
import { apiFetch } from './modules/api.js';

import { ADDON_STYLES } from './themes.js';

const App = Object.assign({}, AppState, {
  setAddonStyle(styleName) {
    this.currentAddonStyle = styleName;
    
    const style = ADDON_STYLES[styleName];
    if (!style) return;

    UI.styleIndicator.style.borderLeftColor = style.color;
    UI.indicatorText.innerHTML = style.indicatorText;
    UI.styleIndicator.style.transform = 'scale(1.05)';
    setTimeout(() => { UI.styleIndicator.style.transform = 'scale(1)'; }, 300);
  },

  resetApp() {
    console.log("🔄 Resetting app data after network change...");
    
    stopAnimation(this);
    
    if (this.ctx) {
      this.ctx.clearRect(0, 0, UI.canvas.width, UI.canvas.height);
      this.ctx.fillStyle = '#000';
      this.ctx.fillRect(0, 0, UI.canvas.width, UI.canvas.height);
    }
    
    this.tokens = [];
    this.ethBalance = 0;
    this.txCount = 0;
    this.particles = [];
    this.initialParticles = [];
    this.nftCenters = [];
    this.particleCache.clear();
    
    this.account = null;
    this.provider = null;
    this.signer = null;
    
    if (UI.accountDisplay) UI.accountDisplay.textContent = 'Connected account: —';
    if (UI.recordTimer) UI.recordTimer.textContent = 'Recording: 0 / 15 s';
    if (UI.statusMsg) UI.statusMsg.textContent = '';
    if (UI.tokenListContainer) UI.tokenListContainer.style.display = 'none';
    if (UI.tokenListContent) UI.tokenListContent.innerHTML = '';
    
    if (UI.recordBtn) UI.recordBtn.disabled = true;
    if (UI.renderBtn) UI.renderBtn.disabled = true;
    if (UI.generateNFTBtn) {
      UI.generateNFTBtn.disabled = true;
      UI.generateNFTBtn.setAttribute('data-price', '');
    }
    
    updateChainStatus();
    
    showToast('Network changed. Click "Connect Wallet" to reload your assets.', 'info');
    
    console.log("✅ App data cleared. Auth token preserved.");
  },

  handleSessionExpired() {
    console.log("Session expired, cleaning up...");
    showToast('⏰ Session expired. Please reconnect your wallet.', 'warning');
    
    if (this.ctx) {
      this.ctx.clearRect(0, 0, UI.canvas.width, UI.canvas.height);
      this.ctx.fillStyle = '#000';
      this.ctx.fillRect(0, 0, UI.canvas.width, UI.canvas.height);
    }
    
    this.tokens = [];
    this.ethBalance = 0;
    this.txCount = 0;
    this.particles = [];
    this.initialParticles = [];
    this.nftCenters = [];
    this.particleCache.clear();
    
    this.account = null;
    this.provider = null;
    this.signer = null;
    
    if (UI.accountDisplay) UI.accountDisplay.textContent = 'Connected account: —';
    if (UI.tokenListContainer) UI.tokenListContainer.style.display = 'none';
    if (UI.tokenListContent) UI.tokenListContent.innerHTML = '';
    
    if (UI.recordBtn) UI.recordBtn.disabled = true;
    if (UI.renderBtn) UI.renderBtn.disabled = true;
    if (UI.generateNFTBtn) {
      UI.generateNFTBtn.disabled = true;
      UI.generateNFTBtn.setAttribute('data-price', '');
    }
    
    showToast('⏰ Session expired. Please click "Connect Wallet" to reconnect.', 'warning');
  },

  async generateNFT() {
    if (!this.account || !this.provider || !this.signer) { 
      showToast('🔌 Please connect your wallet first', 'warning');
      return; 
    }
    
    showToast('🔄 Switching to Base Sepolia network for minting...', 'info');
    
    await switchToMintChain();
    
    this.provider = new ethers.BrowserProvider(window.ethereum);
    this.signer = await this.provider.getSigner();
    this.account = await this.signer.getAddress();
    
    const loginSuccess = await login(this.signer, this.account);
    if (!loginSuccess) {
      showToast('🔐 Authentication failed. Please reconnect your wallet.', 'error');
      setButtonLoading(UI.generateNFTBtn, false);
      return;
    }
    
    const contractAddress = await getContractAddress();
    let mintPriceEth = "?";
    if (contractAddress) {
      try {
        const contract = new ethers.Contract(contractAddress, CONTRACT_ABI, this.provider);
        const priceWei = await contract.mintPrice();
        mintPriceEth = ethers.formatEther(priceWei);
        UI.generateNFTBtn.setAttribute('data-price', `${mintPriceEth} ETH + gas`);
      } catch(e) {
        console.warn("Could not fetch price on mint chain:", e);
      }
    }
    
    setButtonLoading(UI.generateNFTBtn, true);
    showToast('📸 Creating your NFT assets...', 'info');
    
    try {
      // 1. Izveido attēlu
      const imageBlob = await new Promise((resolve, reject) => {
        UI.canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error('Failed to create image'));
        }, 'image/png');
      });
      
      const imageFileName = `snapshot_${Date.now()}.png`;
      const imageFile = new File([imageBlob], imageFileName, { type: 'image/png' });
      
      // 2. Ieraksta video
      let videoBlob = null;
      let videoFileName = null;
      let videoFile = null;
      
      try {
        const stream = UI.canvas.captureStream(30);
        videoBlob = await new Promise((resolve, reject) => {
          let mimeType = 'video/webm';
          if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'video/mp4';
          const recorder = new MediaRecorder(stream, { mimeType });
          const chunks = [];
          
          recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
          recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
          recorder.onerror = (event) => reject(event?.error || new Error('Recording failed'));
          
          recorder.start(1000);
          setTimeout(() => { if (recorder.state === 'recording') recorder.stop(); }, 15000);
        });
        
        const videoExt = videoBlob.type === 'video/mp4' ? 'mp4' : 'webm';
        videoFileName = `video_${Date.now()}.${videoExt}`;
        videoFile = new File([videoBlob], videoFileName, { type: videoBlob.type });
        showToast('🎬 Video recorded!', 'success');
      } catch (error) {
        console.warn('Video recording failed:', error);
        showToast('🎬 Video failed, continuing without video', 'warning');
      }
      
      // 3. Sūta uz serveri
      showToast('📤 Processing on server...', 'info');
      
      const nftFormData = new FormData();
      nftFormData.append('image', imageFile);
      if (videoFile) nftFormData.append('video', videoFile);
      
      const authToken = localStorage.getItem("auth_token");
      const reqHeaders = authToken ? { "Authorization": `Bearer ${authToken}` } : {};
      
      const serverRes = await fetch('/api/prepare-nft', {
        method: 'POST',
        headers: reqHeaders,
        body: nftFormData
      });
      
      if (!serverRes.ok) {
        const errText = await serverRes.text().catch(() => 'Unknown error');
        throw new Error(`Server error: ${serverRes.status} ${errText}`);
      }
      
      const serverData = await serverRes.json();
      if (!serverData.success) throw new Error(serverData.error || 'Processing failed');
      
      console.log('✅ Serveris apstrādāja:', serverData);
      
      // 4. Izveido metadatus
      const gw = LIGHTHOUSE_GATEWAY;
      const imageUrl = serverData.image.cid ? `${gw}${serverData.image.cid}` : `local://${serverData.image.hash}`;
      
      const metadata = {
        name: "Wallet Visualization NFT",
        description: `Generated from wallet ${this.account} on ${new Date().toISOString()}`,
        image: imageUrl,
        attributes: [
          { trait_type: "ETH Balance", value: this.ethBalance.toString() },
          { trait_type: "Token Count", value: this.tokens.length.toString() },
          { trait_type: "Transaction Count", value: this.txCount.toString() },
          { trait_type: "Visual Style", value: ADDON_STYLES[this.currentAddonStyle].name },
          { trait_type: "Source Chain", value: this.currentVizChain },
          { trait_type: "Generated At", value: new Date().toISOString() }
        ]
      };
      
      if (serverData.video?.cid) metadata.animation_url = `${gw}${serverData.video.cid}`;
      
      const metadataBlob = new Blob([JSON.stringify(metadata, null, 2)], { type: 'application/json' });
      const metadataFileName = `metadata_${Date.now()}.json`;
      
      // 5. Lejupielādē VISUS failus kā vienu ZIP
      showToast('💾 Saving all files as ZIP...', 'info');
      
      const allFiles = [
        { blob: imageBlob, filename: imageFileName },
        { blob: metadataBlob, filename: metadataFileName }
      ];
      if (videoBlob && videoFileName) {
        allFiles.push({ blob: videoBlob, filename: videoFileName });
      }
      await downloadAllFiles(allFiles);
      
      showToast('✅ All files saved as ZIP!', 'success');
      
      // 6. Metadati uz Lighthouse
      let metadataCID = null;
      try {
        const metaRes = await uploadMetadataToIPFS(metadata);
        metadataCID = metaRes.cid || metaRes.ipfs;
        showToast('✅ Metadata uploaded to Lighthouse!', 'success');
      } catch (e) {
        console.warn('Metadata upload failed:', e);
        showToast('⚠️ Metadata upload failed, continuing anyway', 'warning');
      }
      
      // 7. Mint
      showToast('📝 Preparing mint...', 'info');
      
      let mintData;
      try {
        const mintRes = await apiFetch('/api/mint-with-signature', {
          method: 'POST',
          body: JSON.stringify({
            wallet: this.account,
            metadataUri: metadataCID || serverData.image.cid || `local://${serverData.image.hash}`,
            imageHash: serverData.image.hash,
            videoHash: serverData.video?.hash || null
          })
        });
        mintData = await mintRes.json();
      } catch (apiError) {
        console.error("Mint API error:", apiError);
        showToast(`❌ Mint preparation failed: ${apiError.message}`, 'error');
        setButtonLoading(UI.generateNFTBtn, false);
        hideProgress();
        return;
      }
      
      if (!mintData.success) throw new Error(mintData.error || 'Mint preparation failed');
      
      showToast('✍️ Please sign the transaction...', 'info');
      
      const tx = await this.signer.sendTransaction({
        to: mintData.transaction.to,
        data: mintData.transaction.data,
        value: mintData.transaction.value,
        gasLimit: mintData.transaction.gasLimit
      });
      
      showToast('⏳ Waiting for confirmation...', 'info');
      await tx.wait();
      showToast('✅ NFT minted!', 'success');
      
      const ls = serverData.lighthouse.success ? '✅' : '⚠️';
      alert(`✅ NFT minted!\n\n` +
        `Tx: ${tx.hash}\n` +
        `Price: ${ethers.formatEther(mintData.transaction.value)} ETH\n\n` +
        `🔐 Image Hash: ${serverData.image.hash}\n` +
        `${serverData.video ? '🔐 Video Hash: ' + serverData.video.hash + '\n' : ''}` +
        `${metadataCID ? '📄 CID: ' + metadataCID + '\n' : ''}` +
        `\n${ls} Lighthouse: ${serverData.lighthouse.success ? 'OK' : 'Failed (files saved locally)'}` +
        `\n\n💾 All files saved as nft_assets_*.zip`);
      
    } catch (error) {
      console.error(error);
      let msg = error.message || 'Unknown error';
      if (msg.includes('insufficient funds')) msg = '💰 Insufficient funds';
      if (msg.includes('User denied')) msg = '🛑 Cancelled';
      showToast('❌ ' + msg, 'error');
      alert('NFT minting failed.\n\n' + msg);
    } finally { 
      setButtonLoading(UI.generateNFTBtn, false); 
    }
  },

  async renderSnapshot(chain) {
    await renderSnapshot(this, chain);
  },

  cleanupUI() {
    if (this.ctx) {
      this.ctx.clearRect(0, 0, UI.canvas.width, UI.canvas.height);
      this.ctx.fillStyle = '#000';
      this.ctx.fillRect(0, 0, UI.canvas.width, UI.canvas.height);
    }
    this.tokens = [];
    this.ethBalance = 0;
    this.txCount = 0;
    this.particles = [];
    this.initialParticles = [];
    this.nftCenters = [];
    this.particleCache.clear();
    
    if (UI.tokenListContainer) UI.tokenListContainer.style.display = 'none';
    if (UI.tokenListContent) UI.tokenListContent.innerHTML = '';
    if (UI.accountDisplay) UI.accountDisplay.textContent = 'Connected account: —';
    
    if (UI.recordBtn) UI.recordBtn.disabled = true;
    if (UI.renderBtn) UI.renderBtn.disabled = true;
    if (UI.generateNFTBtn) {
      UI.generateNFTBtn.disabled = true;
      UI.generateNFTBtn.setAttribute('data-price', '');
    }
  },

  init() {
    console.log("🚀 Starting Wallet Visualizer with Lighthouse Storage + ZIP Download...");
    initUI();
    resizeCanvas(this);
    
    window.addEventListener('auth:expired', () => {
      this.handleSessionExpired();
    });
    
    UI.connectBtn.addEventListener('click', () => connectWallet(this));
    UI.renderBtn.addEventListener('click', () => this.renderSnapshot(this.currentVizChain));
    UI.generateNFTBtn.addEventListener('click', () => this.generateNFT());
    UI.recordBtn.addEventListener('click', () => startRecording(this));
    
    UI.chainSelect.addEventListener('change', async () => {
      if (this.account) {
        showToast(`Please reconnect wallet to switch to ${UI.chainSelect.value}`, 'info');
      }
    });
    
    document.querySelectorAll('.theme-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.setAddonStyle(btn.getAttribute('data-theme'));
      });
    });
    
    UI.fullscreenIcon.addEventListener('click', () => { 
      if (!document.fullscreenElement) UI.canvas.requestFullscreen().catch(() => {}); 
      else document.exitFullscreen().catch(() => {}); 
    });
    
    UI.toggleInfoIcon.addEventListener('click', () => { 
      this.showInfo = !this.showInfo; 
      if (UI.tokenListContainer) {
        UI.tokenListContainer.style.display = this.showInfo ? 'block' : 'none'; 
      }
      if (this.showInfo) updateTokenListUI(this.tokens); 
    });

    // ============================================ //
    // JAUNUMS: LOGA FUNKCIONALITĀTE (ABOUT MODAL) //
    // ============================================ //
    const modal = document.getElementById("aboutModal");
    const aboutBtn = document.getElementById("aboutBtn");
    const closeBtn = document.querySelector(".close-modal");

    if (aboutBtn && modal && closeBtn) {
      aboutBtn.addEventListener("click", () => {
        modal.style.display = "block";
      });

      closeBtn.addEventListener("click", () => {
        modal.style.display = "none";
      });

      window.addEventListener("click", (event) => {
        if (event.target === modal) {
          modal.style.display = "none";
        }
      });
    } else {
      console.warn("⚠️ About modal elements were not found in the DOM.");
    }
    
    window.addEventListener('resize', () => resizeCanvas(this));
    
    if (window.ethereum) {
      window.ethereum.on('chainChanged', () => {
        setTimeout(() => updateChainStatus(), 100);
      });
    }
    
    window.LOW_POWER_MODE = LOW_POWER_MODE;
    
    showToast('✨ Welcome! Connect your wallet to begin.', 'info');
    console.log('✅ Wallet Visualizer Ready with Local + Lighthouse Storage!');
  }
});

window.App = App;
App.init();
