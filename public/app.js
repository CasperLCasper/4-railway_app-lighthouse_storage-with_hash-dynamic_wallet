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
  showIPFSPreview, downloadFile, calculateHashFromBlob 
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
      // =============================================
      // 1. 📸 IZVEIDO ATTĒLU NO CANVAS
      // =============================================
      const imageBlob = await new Promise((resolve, reject) => {
        UI.canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error('Failed to create image'));
        }, 'image/png');
      });
      
      const imageFileName = `snapshot_${Date.now()}.png`;
      const imageFile = new File([imageBlob], imageFileName, { type: 'image/png' });
      
      // =============================================
      // 2. 🎬 IERAKSTA VIDEO
      // =============================================
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
          recorder.onstop = () => {
            const blob = new Blob(chunks, { type: mimeType });
            resolve(blob);
          };
          recorder.onerror = (event) => {
            reject(event?.error || new Error('Recording failed'));
          };
          
          recorder.start(1000);
          setTimeout(() => { if (recorder.state === 'recording') recorder.stop(); }, 15000);
        });
        
        const videoExt = videoBlob.type === 'video/mp4' ? 'mp4' : 'webm';
        videoFileName = `video_${Date.now()}.${videoExt}`;
        videoFile = new File([videoBlob], videoFileName, { type: videoBlob.type });
        
        showToast('🎬 Video recorded successfully!', 'success');
      } catch (error) {
        console.warn('Video recording failed:', error);
        showToast('🎬 Video recording failed, continuing without video', 'warning');
      }
      
      // =============================================
      // 3. 🔐 APRĒĶINA HASH NO LOKĀLAJIEM FAILIEM
      // =============================================
      showToast('🔐 Calculating hashes from local files...', 'info');
      
      const localImageHash = await calculateHashFromBlob(imageBlob);
      console.log('🔐 Local Image Hash:', localImageHash);
      
      let localVideoHash = null;
      if (videoBlob) {
        localVideoHash = await calculateHashFromBlob(videoBlob);
        console.log('🔐 Local Video Hash:', localVideoHash);
      }
      
      // =============================================
      // 4. 📄 IZVEIDO METADATUS
      // =============================================
      const metadata = {
        name: "Wallet Visualization NFT",
        description: `Generated from wallet ${this.account} on ${new Date().toISOString()}`,
        image: `${LIGHTHOUSE_GATEWAY}PLACEHOLDER`,
        attributes: [
          { trait_type: "ETH Balance", value: this.ethBalance.toString() },
          { trait_type: "Token Count", value: this.tokens.length.toString() },
          { trait_type: "Transaction Count", value: this.txCount.toString() },
          { trait_type: "Visual Style", value: ADDON_STYLES[this.currentAddonStyle].name },
          { trait_type: "Source Chain", value: this.currentVizChain },
          { trait_type: "Generated At", value: new Date().toISOString() }
        ]
      };
      
      const metadataBlob = new Blob([JSON.stringify(metadata, null, 2)], { type: 'application/json' });
      const metadataFileName = `metadata_${Date.now()}.json`;
      
      // =============================================
      // 5. 💾 LEJUPIELĀDĒ VISUS FAILUS
      // =============================================
      showToast('💾 Downloading files to your computer...', 'info');
      
      downloadFile(imageBlob, imageFileName);
      
      if (videoBlob && videoFileName) {
        downloadFile(videoBlob, videoFileName);
      }
      
      downloadFile(metadataBlob, metadataFileName);
      
      showToast('✅ All files saved to your computer!', 'success');
      
      // =============================================
      // 6. 📤 AUGŠUPIELĀDĒ UZ LIGHTHOUSE
      // =============================================
      showToast('📤 Uploading to Lighthouse...', 'info');
      
      const imageResult = await uploadFileToIPFS(imageFile);
      this.lastImageURL = imageResult;
      
      let videoResult = null;
      if (videoFile) {
        try {
          videoResult = await uploadFileToIPFS(videoFile);
          this.lastVideoURL = videoResult;
        } catch (error) {
          console.warn('Video upload to Lighthouse failed:', error);
          showToast('🎬 Video upload failed, continuing without video', 'warning');
        }
      }
      
      // =============================================
      // 7. ✅ SALĪDZINA HASH
      // =============================================
      if (localImageHash !== imageResult.hash) {
        throw new Error('❌ CRITICAL: Image hash mismatch! Local vs Lighthouse');
      }
      console.log('✅ Image hash verified:', localImageHash);
      
      if (videoResult && localVideoHash && localVideoHash !== videoResult.hash) {
        throw new Error('❌ CRITICAL: Video hash mismatch! Local vs Lighthouse');
      }
      if (videoResult && localVideoHash) {
        console.log('✅ Video hash verified:', localVideoHash);
      }
      
      // =============================================
      // 8. 📄 ATJAUNINA METADATUS AR ĪSTO CID
      // =============================================
      let cleanImageCID = imageResult.cid || imageResult.ipfs;
      if (cleanImageCID && cleanImageCID.startsWith('ipfs://')) {
        cleanImageCID = cleanImageCID.substring(7);
      }
      
      let cleanVideoCID = null;
      if (videoResult && (videoResult.cid || videoResult.ipfs)) {
        cleanVideoCID = videoResult.cid || videoResult.ipfs;
        if (cleanVideoCID && cleanVideoCID.startsWith('ipfs://')) {
          cleanVideoCID = cleanVideoCID.substring(7);
        }
      }
      
      metadata.image = `${LIGHTHOUSE_GATEWAY}${cleanImageCID}`;
      if (videoResult && cleanVideoCID) {
        metadata.animation_url = `${LIGHTHOUSE_GATEWAY}${cleanVideoCID}`;
      }
      
      const metadataResult = await uploadMetadataToIPFS(metadata);
      this.lastMetadataURL = metadataResult;
      
      // =============================================
      // 9. 👁️ PARĀDA PRIEKŠSKATĪJUMU
      // =============================================
      showIPFSPreview(imageResult, videoResult, metadataResult);
      showToast('📝 Preparing mint transaction...', 'info');
      
      // =============================================
      // 10. ⛓️ MINT NFT
      // =============================================
      let mintData;
      try {
        const mintRes = await apiFetch('/api/mint-with-signature', {
          method: 'POST',
          body: JSON.stringify({
            wallet: this.account,
            metadataUri: metadataResult.cid || metadataResult.ipfs,
            imageHash: imageResult.hash || null,
            videoHash: videoResult?.hash || null
          })
        });
        
        mintData = await mintRes.json();
      } catch (apiError) {
        console.error("Mint API call failed:", apiError);
        showToast(`❌ Mint preparation failed: ${apiError.message}`, 'error');
        setButtonLoading(UI.generateNFTBtn, false);
        hideProgress();
        return;
      }
      
      if (!mintData.success) {
        throw new Error(mintData.error || 'Failed to prepare mint transaction');
      }
      
      showToast('✍️ Please sign the transaction in your wallet...', 'info');
      
      const tx = {
        to: mintData.transaction.to,
        data: mintData.transaction.data,
        value: mintData.transaction.value,
        gasLimit: mintData.transaction.gasLimit
      };
      
      const signedTx = await this.signer.sendTransaction(tx);
      showToast('⏳ Transaction submitted, waiting for confirmation...', 'info');
      
      await signedTx.wait();
      showToast('✅ NFT minted successfully! Files saved locally + on Lighthouse!', 'success');
      
      alert(`✅ NFT minted successfully!\n\n` +
        `Transaction: ${signedTx.hash}\n` +
        `Mint price: ${ethers.formatEther(mintData.transaction.value)} ETH\n` +
        `CID: ${metadataResult.cid}\n` +
        `Image Hash: ${imageResult.hash}\n` +
        `Video Hash: ${videoResult?.hash || 'N/A'}\n` +
        `\n💾 Files saved to your Downloads folder:\n` +
        `- ${imageFileName}\n` +
        `${videoFileName ? `- ${videoFileName}\n` : ''}` +
        `- ${metadataFileName}\n` +
        `\n🌐 Lighthouse Gateway:\n` +
        `${LIGHTHOUSE_GATEWAY}${metadataResult.cid}`);
      
    } catch (error) {
      console.error(error);
      
      let userMessage = '❌ Mint failed. Please try again.';
      if (error.message && error.message.includes('insufficient funds')) {
        userMessage = '💰 Insufficient funds. Please add ETH to your wallet.';
      } else if (error.message && error.message.includes('User denied')) {
        userMessage = '🛑 You cancelled the transaction.';
      } else if (error.message && error.message.includes('Network is Base Sepolia')) {
        userMessage = '🌐 Please switch to Base Sepolia network in your wallet.';
      } else if (error.message && error.message.includes('hash mismatch')) {
        userMessage = '🔐 Security: File hash mismatch detected! Files may have been tampered with.';
      }
      
      showToast(userMessage, 'error');
      alert(`NFT minting failed.\n\n${userMessage}`);
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
    console.log("🚀 Starting Wallet Visualizer with Lighthouse Storage + Local Download...");
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
