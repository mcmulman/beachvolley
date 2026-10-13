(function (root) {
  'use strict';

  var overlay;
  var video;
  var canvas;
  var statusNode;
  var cameraButton;
  var imageInput;
  var opener;
  var stream = null;
  var frame = 0;
  var lastScan = 0;
  var cameraRequest = 0;
  var starting = false;
  var decoderPromise = null;
  var decoderUrl = 'core/vendor/jsQR.js';

  function text(key, fallback) {
    return root.TI18n && root.TI18n.active() ? root.TI18n.t(key) : fallback;
  }

  function decoderLoadError(message) {
    var error = new Error(message);
    error.name = 'DecoderLoadError';
    return error;
  }

  function ensureDecoder() {
    if (typeof root.jsQR === 'function') return Promise.resolve(root.jsQR);
    if (decoderPromise) return decoderPromise;

    decoderPromise = new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      var current = document.currentScript;
      if (current && current.src) decoderUrl = new URL('vendor/jsQR.js', current.src).href;
      script.src = decoderUrl;
      script.onload = function () {
        if (typeof root.jsQR === 'function') resolve(root.jsQR);
        else reject(decoderLoadError('QR decoder did not initialize'));
      };
      script.onerror = function () {
        decoderPromise = null;
        reject(decoderLoadError('QR decoder could not be loaded'));
      };
      document.head.appendChild(script);
    });
    return decoderPromise;
  }

  function makeOverlay() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.className = 'qr-scan-overlay';
    overlay.hidden = true;
    overlay.innerHTML =
      '<section class="qr-scan-dialog" role="dialog" aria-modal="true" aria-labelledby="qr-scan-title">' +
        '<div class="qr-scan-heading"><h2 id="qr-scan-title"></h2>' +
          '<button type="button" class="qr-scan-close" data-qr-close></button></div>' +
        '<div class="qr-scan-view"><video autoplay muted playsinline></video>' +
          '<div class="qr-scan-guide" aria-hidden="true"></div></div>' +
        '<p class="qr-scan-status" role="status" aria-live="polite"></p>' +
        '<div class="qr-scan-actions">' +
          '<button type="button" class="qr-scan-start"></button>' +
          '<button type="button" class="qr-scan-image"></button>' +
          '<input type="file" accept="image/*" capture="environment" class="qr-scan-file" tabindex="-1" aria-hidden="true">' +
        '</div>' +
      '</section>';

    video = overlay.querySelector('video');
    canvas = document.createElement('canvas');
    statusNode = overlay.querySelector('.qr-scan-status');
    cameraButton = overlay.querySelector('.qr-scan-start');
    imageInput = overlay.querySelector('.qr-scan-file');

    overlay.querySelector('#qr-scan-title').textContent = text('home.qr.title', 'Geteiltes Turnier per QR-Code öffnen');
    overlay.querySelector('[data-qr-close]').setAttribute('aria-label', text('home.qr.close', 'Schließen'));
    overlay.querySelector('[data-qr-close]').textContent = '×';
    cameraButton.textContent = text('home.qr.start', 'Kamera starten');
    overlay.querySelector('.qr-scan-image').textContent = text('home.qr.chooseImage', 'QR-Bild auswählen');

    overlay.querySelector('[data-qr-close]').addEventListener('click', close);
    overlay.querySelector('.qr-scan-image').addEventListener('click', function () { imageInput.click(); });
    cameraButton.addEventListener('click', function () {
      if (stream || starting) stopCamera();
      else startCamera();
    });
    imageInput.addEventListener('change', readImage);
    overlay.addEventListener('click', function (event) {
      if (event.target === overlay) close();
    });
    overlay.addEventListener('keydown', trapFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);
    root.addEventListener('pagehide', stopCamera);
    document.body.appendChild(overlay);
  }

  function setStatus(key, fallback) {
    statusNode.textContent = text(key, fallback);
  }

  function open() {
    makeOverlay();
    opener = document.activeElement;
    overlay.hidden = false;
    document.body.classList.add('qr-scan-open');
    overlay.querySelector('[data-qr-close]').focus();
    setStatus('home.qr.starting', 'Kamera wird gestartet …');
    startCamera();
  }

  function close() {
    if (!overlay || overlay.hidden) return;
    stopCamera();
    overlay.hidden = true;
    document.body.classList.remove('qr-scan-open');
    if (opener && typeof opener.focus === 'function') opener.focus();
  }

  function trapFocus(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    var items = overlay.querySelectorAll('button:not([disabled])');
    var first = items[0];
    var last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function stopCamera() {
    cameraRequest += 1;
    starting = false;
    if (frame) root.cancelAnimationFrame(frame);
    frame = 0;
    if (stream) {
      stream.getTracks().forEach(function (track) { track.stop(); });
      stream = null;
    }
    if (video) video.srcObject = null;
    if (cameraButton) cameraButton.textContent = text('home.qr.start', 'Kamera starten');
  }

  function cameraError(error) {
    stopCamera();
    if (error && error.name === 'DecoderLoadError') {
      setStatus('home.qr.decoderError', 'Der QR-Scanner konnte nicht geladen werden. Lade die Seite neu und versuche es erneut.');
    } else if (error && (error.name === 'NotAllowedError' || error.name === 'SecurityError' || error.name === 'PermissionDeniedError')) {
      setStatus('home.qr.permissionDenied', 'Kamerazugriff verweigert. Erlaube den Zugriff in den Geräteeinstellungen oder wähle ein QR-Bild aus.');
    } else if (error && error.name === 'NotFoundError') {
      setStatus('home.qr.noCamera', 'Keine Kamera gefunden. Du kannst stattdessen ein QR-Bild auswählen.');
    } else if (error && error.name === 'NotSupportedError') {
      setStatus('home.qr.unsupported', 'Live-Scan ist hier nicht verfügbar. Wähle stattdessen ein QR-Bild aus.');
    } else if (!root.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus('home.qr.unsupported', 'Live-Scan ist hier nicht verfügbar. Wähle stattdessen ein QR-Bild aus.');
    } else {
      setStatus('home.qr.cameraUnavailable', 'Die Kamera ist nicht verfügbar. Prüfe die Berechtigung oder wähle ein QR-Bild aus.');
    }
  }

  function startCamera() {
    if (stream || starting) return;
    var request = ++cameraRequest;
    starting = true;
    cameraButton.textContent = text('home.qr.stop', 'Kamera stoppen');
    setStatus('home.qr.starting', 'Kamera wird gestartet …');
    ensureDecoder().then(function () {
      if (request !== cameraRequest || overlay.hidden) return null;
      if (!root.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw Object.assign(new Error('Camera API unavailable'), { name: 'NotSupportedError' });
      }
      return navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' } }
      });
    }).then(function (cameraStream) {
      if (!cameraStream) return null;
      if (request !== cameraRequest || overlay.hidden) {
        cameraStream.getTracks().forEach(function (track) { track.stop(); });
        return null;
      }
      starting = false;
      stream = cameraStream;
      video.srcObject = stream;
      cameraButton.textContent = text('home.qr.stop', 'Kamera stoppen');
      setStatus('home.qr.pointCamera', 'QR-Code in den Kamerarahmen halten.');
      return video.play();
    }).then(function () {
      if (stream && request === cameraRequest) {
        lastScan = 0;
        frame = root.requestAnimationFrame(scanFrame);
      }
    }).catch(function (error) {
      if (request === cameraRequest) {
        starting = false;
        cameraError(error);
      }
    });
  }

  function scanFrame(timestamp) {
    frame = root.requestAnimationFrame(scanFrame);
    if (!stream || timestamp - lastScan < 120 || !video.videoWidth || !video.videoHeight) return;
    lastScan = timestamp;
    try {
      var scale = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight));
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      var context = canvas.getContext('2d');
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      var decoded = decodeImageData(context.getImageData(0, 0, canvas.width, canvas.height));
      if (decoded) acceptDecodedText(decoded.data);
    } catch (error) {
      stopCamera();
      setStatus('home.qr.cameraUnavailable', 'Die Kamera ist nicht verfügbar. Prüfe die Berechtigung oder wähle ein QR-Bild aus.');
    }
  }

  function decodeImageData(imageData) {
    if (typeof root.jsQR !== 'function') throw new Error('QR decoder is not ready');
    return root.jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'dontInvert' });
  }

  function acceptDecodedText(value) {
    var result = String(value || '').trim();
    if (!result) return false;
    stopCamera();
    close();
    var input = document.getElementById('code-open-input');
    var form = document.getElementById('code-open-form');
    if (!input || !form) return false;
    input.value = result;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    return true;
  }

  function readImage() {
    var file = imageInput.files && imageInput.files[0];
    if (!file) return;
    setStatus('home.qr.readingImage', 'QR-Bild wird gelesen …');
    ensureDecoder().then(function () {
      var image = new Image();
      image.onload = function () {
        try {
          var scale = Math.min(1, 1280 / Math.max(image.naturalWidth, image.naturalHeight));
          canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
          canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
          var context = canvas.getContext('2d');
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          var decoded = decodeImageData(context.getImageData(0, 0, canvas.width, canvas.height));
          if (decoded) acceptDecodedText(decoded.data);
          else setStatus('home.qr.noCode', 'In diesem Bild wurde kein QR-Code erkannt. Versuche es erneut.');
        } catch (error) {
          setStatus('home.qr.imageError', 'Das Bild konnte nicht gelesen werden. Wähle eine andere Bilddatei.');
        }
        root.URL.revokeObjectURL(image.src);
        imageInput.value = '';
      };
      image.onerror = function () {
        root.URL.revokeObjectURL(image.src);
        imageInput.value = '';
        setStatus('home.qr.imageError', 'Das Bild konnte nicht gelesen werden. Wähle eine andere Bilddatei.');
      };
      image.src = root.URL.createObjectURL(file);
    }).catch(function () {
      setStatus('home.qr.decoderError', 'Der QR-Scanner konnte nicht geladen werden. Lade die Seite neu und versuche es erneut.');
    });
  }

  function onVisibilityChange() {
    if (document.hidden && stream) {
      stopCamera();
      setStatus('home.qr.cameraUnavailable', 'Die Kamera ist nicht verfügbar. Prüfe die Berechtigung oder wähle ein QR-Bild aus.');
    }
  }

  function bind() {
    var button = document.getElementById('code-open-scan');
    if (button) button.addEventListener('click', open);
  }

  root.TQrScanner = Object.freeze({
    open: open,
    close: close,
    stop: stopCamera,
    decodeImageData: decodeImageData,
    acceptDecodedText: acceptDecodedText
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})(typeof window !== 'undefined' ? window : globalThis);
