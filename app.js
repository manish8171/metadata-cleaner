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
      const reader = new FileReader();
      reader.onload = function (e) {
        const view = new DataView(e.target.result);
        const meta = {};
        if (view.getUint16(0) === 0xffd8) {
          Object.assign(meta, parseExif(view));
        } else if (view.getUint32(0) === 0x89504e47 && view.getUint32(4) === 0x0d0a1a0a) {
          // PNG chunk parser
          let offset = 8;
          while (offset < view.byteLength) {
            if (offset + 8 > view.byteLength) break;
            const length = view.getUint32(offset);
            const type = String.fromCharCode(
              view.getUint8(offset + 4), view.getUint8(offset + 5),
              view.getUint8(offset + 6), view.getUint8(offset + 7)
            );
            if (['tEXt', 'iTXt', 'zTXt'].includes(type)) {
              let kw = '';
              let i = 0;
              while (i < length && offset + 8 + i < view.byteLength && view.getUint8(offset + 8 + i) !== 0) {
                kw += String.fromCharCode(view.getUint8(offset + 8 + i));
                i++;
              }
              if (kw) meta['PNG ' + type + ' (' + kw + ')'] = '⚠️ Present';
            }
            offset += 8 + length + 4;
          }
        }
        meta['File Name'] = file.name;
        meta['File Size'] = formatBytes(file.size);
        meta['File Type'] = file.type;
        meta['Last Modified'] = new Date(file.lastModified).toLocaleString();
        resolve(meta);
      };
      reader.onerror = () => resolve({ 'File Name': file.name, 'File Size': formatBytes(file.size) });
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
      if (marker === 0xffda) break; // SOS — image data starts, no more headers

      if (marker === 0xffe1) {
        const segLen = view.getUint16(offset + 2);
        const payloadStart = offset + 4;

        // Check for EXIF block: 'Exif\0\0'
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
          const n = g16(tiffStart + ifdOff);
          const TAGS = {
            0x010f: 'Camera Make', 0x0110: 'Camera Model', 0x0112: 'OrientationRaw',
            0x0131: 'Software', 0x0132: 'Date/Time', 0x8825: 'GPS IFD',
            0x9003: 'Date Original', 0x920a: 'Focal Length', 0x829a: 'Exposure Time',
            0x829d: 'F-Number', 0x8827: 'ISO Speed', 0xa434: 'Lens Model'
          };
          for (let i = 0; i < n && i < 40; i++) {
            const eo = tiffStart + ifdOff + 2 + i * 12;
            if (eo + 12 > length) break;
            const tag = g16(eo), type = g16(eo + 2), count = g32(eo + 4);
            if (TAGS[tag]) {
              let val = '';
              if (type === 2) {
                let so = count > 4 ? tiffStart + g32(eo + 8) : eo + 8;
                if (so + count <= length) {
                  const b = [];
                  for (let j = 0; j < count - 1; j++) { const c = view.getUint8(so + j); if (c > 0) b.push(c); }
                  val = String.fromCharCode(...b);
                }
              } else if (type === 3) {
                val = g16(eo + 8).toString();
              } else if (type === 4) {
                val = g32(eo + 8).toString();
              } else if (type === 5) {
                const ro = tiffStart + g32(eo + 8);
                if (ro + 8 <= length) { const num = g32(ro), den = g32(ro + 4); val = den ? (num / den).toFixed(2) : num.toString(); }
              }
              if (val && tag !== 0x8825) meta[TAGS[tag]] = val;
              if (tag === 0x8825) meta['GPS Data'] = '⚠️ Location Embedded!';
            }
          }
          meta['EXIF Data'] = '⚠️ Present';

          // FIX: Check for XMP block using full namespace string, not just 'http'
          // XMP APP1 starts with: 'http://ns.adobe.com/xap/1.0/\0'
        } else if (payloadStart + 29 <= length && readAscii(view, payloadStart, 29) === 'http://ns.adobe.com/xap/1.0/\0') {
          meta['XMP Data'] = '⚠️ Present (Adobe/Copyright)';
        }

        // Use segment length from header, not hardcoded step, for correct traversal
        if (segLen <= 0) break;
        offset += 2 + segLen;
        continue;
      }

      if (marker === 0xffed) {
        meta['IPTC Data'] = '⚠️ Present';
      }

      const segLen = view.getUint16(offset + 2);
      if (segLen <= 0) break;
      offset += 2 + segLen;
    }
    return meta;
  }

  // Helper: read N bytes as ASCII string from a DataView
  function readAscii(view, offset, length) {
    let str = '';
    for (let i = 0; i < length; i++) {
      if (offset + i >= view.byteLength) break;
      str += String.fromCharCode(view.getUint8(offset + i));
    }
    return str;
  }

  function stripMetadata(file, orientationRaw) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const c = document.createElement('canvas');
        const ctx = c.getContext('2d');
        const width = img.naturalWidth;
        const height = img.naturalHeight;
        const orientation = parseInt(orientationRaw, 10) || 1;

        if (orientation >= 5 && orientation <= 8) {
          c.width = height; c.height = width;
        } else {
          c.width = width; c.height = height;
        }

        switch (orientation) {
          case 2: ctx.transform(-1, 0, 0, 1, width, 0); break;
          case 3: ctx.transform(-1, 0, 0, -1, width, height); break;
          case 4: ctx.transform(1, 0, 0, -1, 0, height); break;
          case 5: ctx.transform(0, 1, 1, 0, 0, 0); break;
          case 6: ctx.transform(0, 1, -1, 0, height, 0); break;
          case 7: ctx.transform(0, -1, -1, 0, height, width); break;
          case 8: ctx.transform(0, -1, 1, 0, 0, width); break;
          default: break;
        }

        ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(url); // revoke the load URL immediately after draw
        const mime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
        const q = mime === 'image/png' ? undefined : 0.95;
        c.toBlob((b) => b ? resolve(b) : reject(new Error('Failed to create clean image')), mime, q);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Failed to load image')); };
      img.src = url;
    });
  }

  function createResultCard(id, name, size) {
    const card = document.createElement('div');
    card.className = 'result-card';
    card.id = id;
    card.innerHTML =
      '<div class="result-card-header">' +
      '<div class="result-thumb" style="background:var(--glass);display:flex;align-items:center;justify-content:center;"><div class="spinner"></div></div>' +
      '<div class="result-info"><div class="result-filename">' + esc(name) + '</div><div class="result-size">Original: ' + formatBytes(size) + '</div></div>' +
      '<div class="result-status status-cleaning"><div class="spinner"></div> Cleaning...</div>' +
      '</div>';
    return card;
  }

  function updateResultCard(id, result, origFile) {
    const card = document.getElementById(id);
    if (!card) return;

    // FIX: Track this blob URL so it can be revoked when the user clears results
    const thumbUrl = URL.createObjectURL(result.cleanBlob);
    activeBlobUrls.push(thumbUrl);

    const me = Object.entries(result.originalMeta).filter(
      ([k]) => !['File Name', 'File Size', 'File Type', 'Last Modified', 'OrientationRaw'].includes(k)
    );
    const hasExif = me.length > 0;

    let html =
      '<div class="result-card-header">' +
      '<img class="result-thumb" src="' + thumbUrl + '" alt="Clean" loading="lazy">' +
      '<div class="result-info">' +
      '<div class="result-filename">' + esc(result.name) + '</div>' +
      '<div class="result-size">Original: ' + formatBytes(origFile.size) + ' → Clean: ' + formatBytes(result.cleanBlob.size) + '</div>' +
      '</div>' +
      '<div class="result-status status-done">' +
      '<svg class="status-icon checkmark-anim" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>' +
      '</svg> Cleaned!' +
      '</div>' +
      '</div>';

    if (hasExif) {
      html +=
        '<div class="metadata-comparison" id="meta-' + id + '" style="display:none;">' +
        '<div class="metadata-box">' +
        '<div class="metadata-box-title before">' +
        '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>' +
        ' Before (Exposed)' +
        '</div>' +
        '<ul class="metadata-list">' +
        me.map(([k, v]) => '<li class="removed"><span>' + esc(k) + '</span><span>' + esc(v) + '</span></li>').join('') +
        '</ul>' +
        '</div>' +
        '<div class="metadata-box">' +
        '<div class="metadata-box-title after">' +
        '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>' +
        ' After (Clean)' +
        '</div>' +
        '<div class="metadata-none">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>' +
        ' All metadata stripped' +
        '</div>' +
        '</div>' +
        '</div>';
    }

    html +=
      '<div class="result-actions">' +
      '<button class="btn-download" data-id="' + id + '">' +
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>' +
      ' Download' +
      '</button>';
    if (hasExif) {
      html +=
        '<button class="btn-toggle-meta" data-target="meta-' + id + '">' +
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>' +
        '</button>';
    }
    html += '</div>';

    card.innerHTML = html;
    card.classList.add('success-flash');

    card.querySelector('.btn-download').addEventListener('click', () => {
      downloadBlob(result.cleanBlob, 'clean_' + result.name);
      showToast('Downloaded!', 'success');
    });
    const tb = card.querySelector('.btn-toggle-meta');
    if (tb) {
      tb.addEventListener('click', () => {
        const m = document.getElementById('meta-' + id);
        if (m) m.style.display = m.style.display === 'none' ? '' : 'none';
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