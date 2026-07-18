# 🛡️ MetaClean — Instant Photo Privacy & Metadata Stripper

> **100% Client-Side • Photos Never Leave Your Device • Works Offline (PWA)**

**MetaClean** is a privacy-first web application designed to instantly strip hidden EXIF, GPS location, device model, timestamp, and camera metadata from your photos before sharing them online or sending them in messaging apps.

---

## ✨ Features

- 📸 **Live Laptop / Desktop WebRTC Camera Viewfinder**: Tap to capture directly from your laptop's front camera or webcam with live mirror preview, framing grid, and instant shutter.
- 📱 **Mobile Native Camera & Gallery**: On mobile devices, seamlessly opens the native camera or image picker.
- 🛡️ **100% Client-Side Privacy**: All processing is done locally in your browser using HTML5 Canvas & JavaScript. No server, no uploads, zero tracking.
- 📊 **Detailed Metadata Comparison**: View exact stripped metadata (GPS coordinates, camera specs, exposure settings, timestamps) side-by-side with before & after visual cards.
- ⚡ **Auto-Save & Bulk Download**: Automatically save cleaned photos or download them in bulk.
- 🌐 **PWA & Offline Support**: Fully installable Progressive Web App (PWA) with Service Worker caching so it works offline anywhere.
- 🎨 **Modern Glassmorphism UI**: Beautiful dark-mode UI with smooth micro-animations and responsive layout.

---

## 🔒 What Metadata Gets Stripped?

When you take or upload a photo, standard cameras automatically embed hidden EXIF data. MetaClean completely strips:

| Metadata Field | Description | Status |
| :--- | :--- | :---: |
| 📍 **GPS Coordinates** | Latitude, Longitude, Altitude, GPS timestamp | **Removed** |
| 📷 **Camera & Lens Info** | Camera Make, Model, Lens specs, Focal Length, F-Number, ISO | **Stripped** |
| 📅 **Timestamps** | Date/Time Original, Digitized date, File creation timestamp | **Cleared** |
| ⚙️ **Software & Device** | Device serial numbers, OS build, Firmware version | **Stripped** |
| 🏷️ **EXIF / XMP / IPTC** | Embedded thumbnail images, Adobe XMP tags, Copyright notes | **Cleaned** |

---

## 🚀 How It Works

1. **Capture or Choose**: Click **Tap to Capture** to launch your live webcam/camera, or drag-and-drop photos from your device.
2. **Instant Local Processing**: Photos are rendered directly onto an in-browser HTML5 canvas context, stripping all binary EXIF headers while preserving image quality.
3. **Download Safely**: Review the stripped metadata comparison and download your 100% clean photo.

---

## 🛠️ Technology Stack

- **Frontend**: HTML5, Vanilla JavaScript (ES6+), Vanilla CSS3 (CSS Variables, Flexbox, Grid, Glassmorphic styling)
- **Camera Stream**: WebRTC `navigator.mediaDevices.getUserMedia`
- **Metadata Parsing**: Binary DataView EXIF/XMP header parsing
- **PWA**: Service Worker (`sw.js`), Web App Manifest (`manifest.json`)
- **Zero Dependencies**: Lightweight, dependency-free codebase for maximum performance & privacy security.

---

## 💻 Local Setup & Running

Simply serve the project folder using any local HTTP server:

```bash
# Clone the repository
git clone https://github.com/manish8171/metadata-cleaner.git
cd metadata-cleaner

# Start a local server (Python 3)
python3 -m http.server 8085

# Or using Node.js / npx
npx serve -l 8085 .
```

Open `http://localhost:8085` in your browser (Google Chrome, Brave, Firefox, Edge, or Safari).

---

## 📄 License

MIT License — Free to use, modify, and distribute for personal and commercial privacy protection.
