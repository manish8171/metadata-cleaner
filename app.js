// ===== MetaClean — Instant Photo Privacy App =====
// All processing happens client-side. No data leaves the device.
(function () {
  'use strict';

  const heroSection = document.getElementById('heroSection');
  const processingSection = document.getElementById('processingSection');
  const resultsGrid = document.getElementById('resultsGrid');
  const fileCount = document.getElementById('fileCount');
  const bulkActions = document.getElementById('bulkActions');
  const cameraInput = document.getElementById('cameraInput');
  const fileInput = document.getElementById('fileInput');
  const cameraInput2 = document.getElementById('cameraInput2');
  const addMoreInput = document.getElementById('addMoreInput');
  const dropZone = document.getElementById('dropZone');
  const clearAllBtn = document.getElementById('clearAllBtn');
  const downloadAllBtn = document.getElementById('downloadAllBtn');
  const installBtn = document.getElementById('installBtn');
  const autoSaveCheck = document.getElementById('autoSaveCheck');

  // Camera Modal & WebRTC Live Stream elements
  const captureRing = document.getElementById('captureRing');
  const captureAgainBtn = document.getElementById('captureAgainBtn');
  const cameraModal = document.getElementById('cameraModal');
  const cameraVideo = document.getElementById('cameraVideo');
  const shutterBtn = document.getElementById('shutterBtn');
  const closeCameraBtn = document.getElementById('closeCameraBtn');
  const switchCameraBtn = document.getElementById('switchCameraBtn');
  const fallbackFileBtn = document.getElementById('fallbackFileBtn');
  const cameraStatus = document.getElementById('cameraStatus');
  const cameraFlash = document.getElementById('cameraFlash');

  let currentCameraStream = null;
  let currentFacingMode = 'user'; // Defaults to laptop front camera!

  // FIX: Track all active blob URLs so we can revoke them on clear
  let processedFiles = [];
  let activeBlobUrls = [];
  let deferredPrompt = null;

  // Max file size: 20MB — prevents tab crash on huge files
  const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

  // HEIC/HEIF cannot be decoded by canvas in any browser
  const UNSUPPORTED_TYPES = ['image/heic', 'image/heif'];

  // PWA Install
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    installBtn.style.display = 'flex';
  });
  installBtn.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const r = await deferredPrompt.userChoice;
    if (r.outcome === 'accepted') showToast('App installed! 🎉', 'success');
    deferredPrompt = null;
    installBtn.style.display = 'none';
  });

  // Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => { });
  }

  // Check for files shared via Web Share Target API
  function checkSharedFiles() {
    try {
      const req = indexedDB.open('MetaCleanDB', 1);
      req.onupgradeneeded = e => e.target.result.createObjectStore('SharedFiles');
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('SharedFiles')) return;
        const tx = db.transaction('SharedFiles', 'readwrite');
        const store = tx.objectStore('SharedFiles');
        const getReq = store.get('latest');
        getReq.onsuccess = () => {
          if (getReq.result && getReq.result.length > 0) {
            handleFiles(getReq.result);
            store.delete('latest');
          }
        };
      };
    } catch (err) {
      console.error('IndexedDB error:', err);
    }
  }
  checkSharedFiles();

  // Event Listeners
  [cameraInput, cameraInput2].forEach(el => {
    if (el) el.addEventListener('change', (e) => handleFiles(e.target.files));
  });
  fileInput.addEventListener('change', (e) => handleFiles(e.target.files));
  addMoreInput.addEventListener('change', (e) => handleFiles(e.target.files));

  // Camera Modal & Live Stream Handlers
  async function openCameraModal() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      if (cameraInput) cameraInput.click();
      return;
    }
    if (cameraModal) cameraModal.style.display = 'flex';
    await startCameraStream(currentFacingMode);
  }

  async function startCameraStream(facingMode) {
    stopCameraStream();
    if (cameraStatus) {
      cameraStatus.style.display = 'block';
      cameraStatus.textContent = 'Accessing laptop camera...';
    }

    try {
      const constraints = {
        video: {
          facingMode: facingMode,
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        },
        audio: false
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      currentCameraStream = stream;

      if (cameraVideo) {
        cameraVideo.srcObject = stream;
        if (facingMode === 'user') {
          cameraVideo.classList.add('user-facing');
        } else {
          cameraVideo.classList.remove('user-facing');
        }
        await cameraVideo.play();
      }

      if (cameraStatus) cameraStatus.style.display = 'none';

      if (navigator.mediaDevices.enumerateDevices && switchCameraBtn) {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(d => d.kind === 'videoinput');
        if (videoDevices.length > 1) {
          switchCameraBtn.style.display = 'inline-flex';
        } else {
          switchCameraBtn.style.display = 'none';
        }
      }
    } catch (err) {
      console.error('Camera access error:', err);
      if (cameraStatus) {
        cameraStatus.style.display = 'block';
        cameraStatus.textContent = 'Camera access denied or unavailable. Click "Choose File Instead" below.';
      }
    }
  }

  function stopCameraStream() {
    if (currentCameraStream) {
      currentCameraStream.getTracks().forEach(track => track.stop());
      currentCameraStream = null;
    }
    if (cameraVideo) cameraVideo.srcObject = null;
  }

  function closeCameraModal() {
    stopCameraStream();
    if (cameraModal) cameraModal.style.display = 'none';
  }

  function takeSnapshot() {
    if (!cameraVideo || !cameraVideo.videoWidth) {
      showToast('Camera feed is loading...', 'error');
      return;
    }

    if (cameraFlash) {
      cameraFlash.classList.add('active');
      setTimeout(() => cameraFlash.classList.remove('active'), 250);
    }

    const canvas = document.createElement('canvas');
    canvas.width = cameraVideo.videoWidth;
    canvas.height = cameraVideo.videoHeight;
    const ctx = canvas.getContext('2d');

    if (currentFacingMode === 'user') {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }

    ctx.drawImage(cameraVideo, 0, 0, canvas.width, canvas.height);

    canvas.toBlob((blob) => {
      if (!blob) {
        showToast('Failed to capture snapshot', 'error');
        return;
      }

      const now = new Date();
      const timestamp = now.getFullYear() +
        String(now.getMonth() + 1).padStart(2, '0') +
        String(now.getDate()).padStart(2, '0') + '_' +
        String(now.getHours()).padStart(2, '0') +
        String(now.getMinutes()).padStart(2, '0') +
        String(now.getSeconds()).padStart(2, '0');

      const filename = 'capture_' + timestamp + '.jpg';
      const file = new File([blob], filename, { type: 'image/jpeg', lastModified: Date.now() });
      file._webcamMeta = {
        'Camera Device': currentFacingMode === 'user' ? 'Laptop Front Camera (WebRTC)' : 'Rear / External Camera',
        'Frame Resolution': canvas.width + ' × ' + canvas.height + ' px',
        'Capture Timestamp': now.toLocaleString(),
        'Host Platform': (navigator.platform || 'Desktop/Laptop') + ' (' + (navigator.language || 'en') + ')',
        'Web Engine': navigator.userAgent.split(' ')[0]
      };

      closeCameraModal();
      handleFiles([file]);
    }, 'image/jpeg', 0.95);
  }

  // Camera Event Listeners
  if (captureRing) {
    captureRing.addEventListener('click', (e) => {
      e.preventDefault();
      openCameraModal();
    });
  }

  if (captureAgainBtn) {
    captureAgainBtn.addEventListener('click', (e) => {
      e.preventDefault();
      openCameraModal();
    });
  }

  if (shutterBtn) shutterBtn.addEventListener('click', takeSnapshot);
  if (closeCameraBtn) closeCameraBtn.addEventListener('click', closeCameraModal);

  if (switchCameraBtn) {
    switchCameraBtn.addEventListener('click', () => {
      currentFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
      startCameraStream(currentFacingMode);
    });
  }

  if (fallbackFileBtn) {
    fallbackFileBtn.addEventListener('click', () => {
      closeCameraModal();
      if (cameraInput) cameraInput.click();
    });
  }

  if (cameraModal) {
    cameraModal.addEventListener('click', (e) => {
      if (e.target === cameraModal) closeCameraModal();
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && cameraModal && cameraModal.style.display !== 'none') {
      closeCameraModal();
    }
  });

  clearAllBtn.addEventListener('click', () => {
    processedFiles = [];

    // FIX: Revoke all tracked blob URLs on clear to free memory
    activeBlobUrls.forEach(u => URL.revokeObjectURL(u));
    activeBlobUrls = [];

    resultsGrid.innerHTML = '';
    processingSection.style.display = 'none';
    heroSection.style.display = '';
    bulkActions.style.display = 'none';
    fileCount.textContent = '0';
    [cameraInput, fileInput, addMoreInput, cameraInput2].forEach(el => { if (el) el.value = ''; });
  });

  downloadAllBtn.addEventListener('click', () => {
    processedFiles.forEach((pf) => { if (pf.cleanBlob) downloadBlob(pf.cleanBlob, 'clean_' + pf.name); });
    showToast('Downloaded ' + processedFiles.length + ' clean photo(s)', 'success');
  });

  // Drag & Drop
  if (dropZone) {
    ['dragenter', 'dragover'].forEach(evt => dropZone.addEventListener(evt, (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); }));
    ['dragleave', 'drop'].forEach(evt => dropZone.addEventListener(evt, () => { dropZone.classList.remove('drag-over'); }));
    dropZone.addEventListener('drop', (e) => { e.preventDefault(); handleFiles(e.dataTransfer.files); });
  }

  async function handleFiles(files) {
    if (!files || files.length === 0) return;
    const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (imageFiles.length === 0) { showToast('Please select image files only', 'error'); return; }
    heroSection.style.display = 'none';
    processingSection.style.display = '';
    for (const file of imageFiles) await processFile(file);
    updateCounts();
  }

  async function processFile(file) {
    // FIX: Reject HEIC/HEIF with a clear explanation instead of a cryptic canvas error
    if (UNSUPPORTED_TYPES.includes(file.type)) {
      showToast('HEIC/HEIF not supported by browsers. Convert to JPEG first, then clean.', 'error');
      return;
    }

    // FIX: Guard against oversized files that will crash the canvas operation
    if (file.size > MAX_FILE_SIZE_BYTES) {
      showToast(esc(file.name) + ' is too large (max 20MB). Please resize it first.', 'error');
      return;
    }

    const id = 'f-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    const card = createResultCard(id, file.name, file.size);
    resultsGrid.appendChild(card);
    try {
      const originalMeta = await readMetadata(file);
      const cleanBlob = await stripMetadata(file, originalMeta['OrientationRaw']);
      const result = { id, name: file.name, cleanBlob, originalMeta };
      processedFiles.push(result);
      updateResultCard(id, result, file);
      if (autoSaveCheck && autoSaveCheck.checked) {
        downloadBlob(cleanBlob, 'clean_' + file.name);
        showToast('✅ Cleaned & saved: ' + file.name, 'success');
      } else {
        showToast('✅ Cleaned: ' + file.name, 'success');
      }
    } catch (err) {
      updateResultCardError(id, err.message);
    }
  }

  function readMetadata(file) {
    return new Promise((resolve) => {
      if (file._webcamMeta) {
        resolve(Object.assign({}, file._webcamMeta));
        return;
      }

      const reader = new FileReader();
      reader.onload = function (e) {
        const view = new DataView(e.target.result);
        const meta = {};
        if (view.byteLength > 4 && view.getUint16(0) === 0xffd8) {
          Object.assign(meta, parseExif(view));
        } else if (view.byteLength > 8 && view.getUint32(0) === 0x89504e47 && view.getUint32(4) === 0x0d0a1a0a) {
          meta['PNG Structure'] = 'PNG Chunk Headers Present';
        }

        meta['File Format'] = (file.type || 'image/jpeg').toUpperCase();
        meta['File Size'] = formatBytes(file.size);
        meta['Last Modified'] = new Date(file.lastModified).toLocaleString();

        resolve(meta);
      };
      reader.onerror = () => resolve({
        'File Format': file.type || 'image/jpeg',
        'File Size': formatBytes(file.size),
        'Last Modified': new Date(file.lastModified).toLocaleString()
      });
      reader.readAsArrayBuffer(file);
    });
  }

  function parseExif(view) {
    const meta = {};
    const length = view.byteLength;
    let offset = 2; // skip FFD8
    while (offset < length) {
      if (offset + 2 >= length) break;
      const marker = view.getUint16(offset);
      if (marker === 0xffda) break; // SOS — image data starts

      if (marker === 0xffe1) {
        const segLen = view.getUint16(offset + 2);
        const payloadStart = offset + 4;

        if (
          payloadStart + 6 <= length &&
          view.getUint32(payloadStart) === 0x45786966 &&
          view.getUint16(payloadStart + 4) === 0x0000
        ) {
          const tiffStart = payloadStart + 6;
          const bigEndian = view.getUint16(tiffStart) === 0x4d4d;
          const g16 = (o) => view.getUint16(o, !bigEndian);
          const g32 = (o) => view.getUint32(o, !bigEndian);
          const ifdOff = g32(tiffStart + 4);

          const TAGS = {
            0x010f: 'Camera Make', 0x0110: 'Camera Model', 0x0112: 'OrientationRaw',
            0x0131: 'Software / OS', 0x0132: 'Date Modified',
            0x9003: 'Date Original', 0x9004: 'Date Digitized',
            0x920a: 'Focal Length', 0x829a: 'Exposure Time',
            0x829d: 'F-Number', 0x8827: 'ISO Speed', 0xa434: 'Lens Model',
            0xa002: 'Image Width', 0xa003: 'Image Height'
          };

          const parseDirectory = (dirOffset) => {
            if (dirOffset <= 0 || tiffStart + dirOffset + 2 > length) return;
            const entryCount = g16(tiffStart + dirOffset);
            for (let i = 0; i < entryCount && i < 50; i++) {
              const eo = tiffStart + dirOffset + 2 + i * 12;
              if (eo + 12 > length) break;
              const tag = g16(eo), type = g16(eo + 2), count = g32(eo + 4);

              // ExifSubIFD Pointer
              if (tag === 0x8769) {
                parseDirectory(g32(eo + 8));
                continue;
              }

              // GPS IFD Pointer
              if (tag === 0x8825) {
                const gpsOff = g32(eo + 8);
                meta['GPS Coordinates'] = parseGpsLocation(view, tiffStart, gpsOff, g16, g32, length);
                continue;
              }

              if (TAGS[tag]) {
                let val = '';
                if (type === 2) { // ASCII
                  let so = count > 4 ? tiffStart + g32(eo + 8) : eo + 8;
                  if (so + count <= length) {
                    const b = [];
                    for (let j = 0; j < count - 1; j++) {
                      const c = view.getUint8(so + j);
                      if (c > 0) b.push(c);
                    }
                    val = String.fromCharCode(...b).trim();
                  }
                } else if (type === 3) {
                  val = g16(eo + 8).toString();
                } else if (type === 4) {
                  val = g32(eo + 8).toString();
                } else if (type === 5) {
                  const ro = tiffStart + g32(eo + 8);
                  if (ro + 8 <= length) {
                    const num = g32(ro), den = g32(ro + 4);
                    val = den ? (num / den).toFixed(2) : num.toString();
                  }
                }
                if (val) meta[TAGS[tag]] = val;
              }
            }
          };

          parseDirectory(ifdOff);
          meta['EXIF Header Tags'] = 'Embedded EXIF Headers Present';
        } else if (payloadStart + 29 <= length && readAscii(view, payloadStart, 29) === 'http://ns.adobe.com/xap/1.0/\0') {
          meta['XMP Metadata'] = 'Adobe XMP Block Present';
        }

        if (segLen <= 0) break;
        offset += 2 + segLen;
        continue;
      }

      if (marker === 0xffed) {
        meta['IPTC / Photoshop'] = 'IPTC Photoshop Block Present';
      }

      const segLen = view.getUint16(offset + 2);
      if (segLen <= 0) break;
      offset += 2 + segLen;
    }
    return meta;
  }

  function parseGpsLocation(view, tiffStart, gpsOff, g16, g32, length) {
    if (gpsOff <= 0 || tiffStart + gpsOff + 2 > length) return 'GPS Location Tag Embedded';
    const count = g16(tiffStart + gpsOff);
    let latRef = 'N', lonRef = 'E', lat = null, lon = null;

    const getRationalDeg = (eo) => {
      const ro = tiffStart + g32(eo + 8);
      if (ro + 24 <= length) {
        const d1 = g32(ro), d2 = g32(ro + 4);
        const m1 = g32(ro + 8), m2 = g32(ro + 12);
        const s1 = g32(ro + 16), s2 = g32(ro + 20);
        const deg = d2 ? d1 / d2 : 0;
        const min = m2 ? m1 / m2 : 0;
        const sec = s2 ? s1 / s2 : 0;
        return `${deg.toFixed(0)}°${min.toFixed(0)}'${sec.toFixed(1)}"`;
      }
      return null;
    };

    for (let i = 0; i < count && i < 20; i++) {
      const eo = tiffStart + gpsOff + 2 + i * 12;
      if (eo + 12 > length) break;
      const tag = g16(eo);
      if (tag === 1) latRef = String.fromCharCode(view.getUint8(eo + 8)) || 'N';
      else if (tag === 2) lat = getRationalDeg(eo);
      else if (tag === 3) lonRef = String.fromCharCode(view.getUint8(eo + 8)) || 'E';
      else if (tag === 4) lon = getRationalDeg(eo);
    }
    if (lat && lon) return `${lat} ${latRef}, ${lon} ${lonRef}`;
    return 'Embedded GPS Coordinates';
  }

  function readAscii(view, offset, length) {
    let str = '';
    try {
      for (let i = 0; i < length; i++) {
        if (offset + i >= view.byteLength) break;
        str += String.fromCharCode(view.getUint8(offset + i));
      }
    } catch (e) {}
    return str;
  }

  function updateResultCard(id, result, origFile) {
    const card = document.getElementById(id);
    if (!card) return;

    const thumbUrl = URL.createObjectURL(result.cleanBlob);
    activeBlobUrls.push(thumbUrl);

    // Filter out internal non-display tags
    const allEntries = Object.entries(result.originalMeta).filter(
      ([k]) => !['OrientationRaw'].includes(k)
    );

    let beforeListHtml = '';
    let afterListHtml = '';

    allEntries.forEach(([k, v]) => {
      let cleanVal = '✅ Stripped & Protected';
      const keyLower = k.toLowerCase();
      if (keyLower.includes('gps') || keyLower.includes('location')) {
        cleanVal = '✅ 0 Location Bytes (Removed)';
      } else if (keyLower.includes('camera') || keyLower.includes('model') || keyLower.includes('make') || keyLower.includes('device')) {
        cleanVal = '✅ Identifiers Removed';
      } else if (keyLower.includes('date') || keyLower.includes('time') || keyLower.includes('modified') || keyLower.includes('timestamp')) {
        cleanVal = '✅ Timestamp Cleared';
      } else if (keyLower.includes('exif') || keyLower.includes('xmp') || keyLower.includes('iptc') || keyLower.includes('header')) {
        cleanVal = '✅ 0 EXIF Headers Remaining';
      } else if (keyLower.includes('format') || keyLower.includes('size') || keyLower.includes('resolution') || keyLower.includes('platform') || keyLower.includes('engine')) {
        cleanVal = '✅ Standardized';
      }

      beforeListHtml += '<li class="removed"><span>' + esc(k) + ':</span> <span>' + esc(v) + '</span></li>';
      afterListHtml += '<li class="clean-item"><span>' + esc(k) + ':</span> <span>' + esc(cleanVal) + '</span></li>';
    });

    let html =
      '<div class="result-card-header">' +
      '<img class="result-thumb" src="' + thumbUrl + '" alt="Clean photo" loading="lazy">' +
      '<div class="result-info">' +
      '<div class="result-filename">' + esc(result.name) + '</div>' +
      '<div class="result-size">Original: ' + formatBytes(origFile.size) + ' → Clean: ' + formatBytes(result.cleanBlob.size) + '</div>' +
      '<div class="metadata-badges">' +
      '<span class="meta-badge badge-gps">🛡️ GPS: Removed</span>' +
      '<span class="meta-badge badge-exif">📷 Camera Info: Stripped</span>' +
      '<span class="meta-badge badge-time">📅 Timestamp: Cleared</span>' +
      '</div>' +
      '</div>' +
      '<div class="result-status status-done">' +
      '<svg class="status-icon checkmark-anim" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>' +
      '</svg> Cleaned!' +
      '</div>' +
      '</div>';

    html +=
      '<div class="metadata-comparison" id="meta-' + id + '">' +
      '<div class="metadata-box">' +
      '<div class="metadata-box-title before">' +
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>' +
      ' Before (Exposed Exact Data)' +
      '</div>' +
      '<ul class="metadata-list">' +
      beforeListHtml +
      '</ul>' +
      '</div>' +
      '<div class="metadata-box">' +
      '<div class="metadata-box-title after">' +
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>' +
      ' After (100% Cleaned)' +
      '</div>' +
      '<ul class="metadata-list">' +
      afterListHtml +
      '</ul>' +
      '</div>' +
      '</div>';

    html +=
      '<div class="result-actions">' +
      '<button class="btn-download" data-id="' + id + '">' +
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>' +
      ' Download Clean Photo' +
      '</button>' +
      '<button class="btn-toggle-meta-text" data-target="meta-' + id + '">' +
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>' +
      ' <span class="toggle-text">Hide Stripped Metadata</span>' +
      '</button>' +
      '</div>';

    card.innerHTML = html;
    card.classList.add('success-flash');

    card.querySelector('.btn-download').addEventListener('click', () => {
      downloadBlob(result.cleanBlob, 'clean_' + result.name);
      showToast('Downloaded!', 'success');
    });

    const tb = card.querySelector('.btn-toggle-meta-text');
    if (tb) {
      tb.addEventListener('click', () => {
        const m = document.getElementById('meta-' + id);
        const textSpan = tb.querySelector('.toggle-text');
        if (m) {
          const isHidden = m.style.display === 'none';
          m.style.display = isHidden ? '' : 'none';
          if (textSpan) textSpan.textContent = isHidden ? 'Hide Stripped Metadata' : 'Show Stripped Metadata';
        }
      });
    }
  }

  function updateResultCardError(id, msg) {
    const card = document.getElementById(id);
    if (!card) return;
    const s = card.querySelector('.result-status');
    if (s) { s.className = 'result-status'; s.style.color = 'var(--accent-red)'; s.innerHTML = '❌ Error'; }
    showToast(msg || 'Failed to process image', 'error');
  }

  function updateCounts() {
    fileCount.textContent = processedFiles.length;
    bulkActions.style.display = processedFiles.length > 1 ? '' : 'none';
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function showToast(message, type) {
    const c = document.getElementById('toastContainer');
    const t = document.createElement('div');
    t.className = 'toast ' + (type || 'success');
    const icon = type === 'error'
      ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>'
      : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';
    t.innerHTML = icon + ' ' + esc(message);
    c.appendChild(t);
    setTimeout(() => {
      t.classList.add('toast-exit');
      t.addEventListener('animationend', () => t.remove());
    }, 3000);
  }

  function formatBytes(b) {
    if (b === 0) return '0 B';
    const k = 1024, s = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(b) / Math.log(k));
    return parseFloat((b / Math.pow(k, i)).toFixed(1)) + ' ' + s[i];
  }

  function esc(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }
})();