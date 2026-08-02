// Profile photo: file pick or camera capture, with square-crop and rotate
// applied client-side before upload.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Crop, Loader2, RotateCw, Trash2, Upload, VideoOff } from 'lucide-react';
import { profileCoreApi } from '../../../api/profile';
import { BTN_PRIMARY, BTN_SECONDARY, ErrorBlock } from '../../../components/common/HrmsUI';
import { SectionCard, errorMessage, initialsOf, resolvePhotoSrc } from '../ProfileField';
import type { ProfileSectionProps } from '../ProfileField';

const MAX_BYTES = 5 * 1024 * 1024; // matches the server limit
const OUTPUT_TYPE = 'image/jpeg';

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('That file could not be read as an image.'));
    img.src = url;
  });
}

function canvasToFile(canvas: HTMLCanvasElement, name: string): Promise<File> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Could not process the image in this browser.'));
          return;
        }
        resolve(new File([blob], name, { type: OUTPUT_TYPE }));
      },
      OUTPUT_TYPE,
      0.92,
    );
  });
}

/** Centre-square crop; drops the longer edge evenly on both sides. */
async function cropSquare(file: File): Promise<File> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const sx = (img.naturalWidth - side) / 2;
    const sy = (img.naturalHeight - side) / 2;
    const canvas = document.createElement('canvas');
    canvas.width = side;
    canvas.height = side;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas is not available in this browser.');
    ctx.drawImage(img, sx, sy, side, side, 0, 0, side, side);
    return await canvasToFile(canvas, 'photo.jpg');
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function rotate90(file: File): Promise<File> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalHeight;
    canvas.height = img.naturalWidth;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas is not available in this browser.');
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
    return await canvasToFile(canvas, 'photo.jpg');
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function PhotoSection({ employeeId, profile, onSaved }: ProfileSectionProps) {
  const [pending, setPending] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  const cameraSupported =
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === 'function';

  // A camera left streaming after the panel closes is a real privacy problem,
  // so every track is stopped on close and on unmount.
  const stopCamera = useCallback(() => {
    const stream = streamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  useEffect(() => stopCamera, [stopCamera]);

  useEffect(
    () => () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    },
    [],
  );

  const setPendingFile = useCallback((file: File | null) => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = file ? URL.createObjectURL(file) : null;
    setPreviewUrl(previewUrlRef.current);
    setPending(file);
  }, []);

  const guardSize = (file: File): boolean => {
    if (file.size > MAX_BYTES) {
      setError('That image is larger than 5 MB. Please choose a smaller photo.');
      return false;
    }
    return true;
  };

  const onPick = (fileList: FileList | null) => {
    const file = fileList?.[0];
    if (!file) return;
    setError(null);
    if (!guardSize(file)) return;
    setPendingFile(file);
  };

  const openCamera = () => {
    if (!cameraSupported) return;
    setCameraError(null);
    setCameraOpen(true);
    navigator.mediaDevices
      .getUserMedia({ video: true })
      .then((stream) => {
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play().catch(() => undefined);
        }
      })
      .catch((err: unknown) => {
        setCameraError(
          `Camera unavailable: ${errorMessage(err)}. You can still upload a photo from a file.`,
        );
        stopCamera();
      });
  };

  const closeCamera = () => {
    stopCamera();
    setCameraOpen(false);
  };

  const capture = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) {
      setCameraError('The camera is still starting up — try again in a moment.');
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setCameraError('Canvas is not available in this browser.');
      return;
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    setBusy(true);
    canvasToFile(canvas, 'capture.jpg')
      .then((file) => {
        if (!guardSize(file)) return;
        setError(null);
        setPendingFile(file);
        closeCamera();
      })
      .catch((err: unknown) => setCameraError(errorMessage(err)))
      .finally(() => setBusy(false));
  };

  const applyTransform = (kind: 'crop' | 'rotate') => {
    if (!pending) return;
    setBusy(true);
    (kind === 'crop' ? cropSquare(pending) : rotate90(pending))
      .then((file) => {
        if (!guardSize(file)) return;
        setError(null);
        setPendingFile(file);
      })
      .catch((err: unknown) => window.alert(errorMessage(err)))
      .finally(() => setBusy(false));
  };

  const clearPending = () => {
    setPendingFile(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const upload = () => {
    if (!pending) return;
    if (!guardSize(pending)) return;
    setUploading(true);
    profileCoreApi
      .uploadPhoto(employeeId, pending)
      .then(() => {
        clearPending();
        onSaved();
      })
      .catch((err: unknown) => window.alert(errorMessage(err)))
      .finally(() => setUploading(false));
  };

  const currentSrc = resolvePhotoSrc(profile.photoUrl);
  const hasStoredPhoto = !!profile.photoUrl;

  return (
    <SectionCard title="Photo" subtitle="Used on the profile header, directory and org chart.">
      <div className="space-y-4">
        {error && <ErrorBlock message={error} />}

        <div className="flex items-start gap-6 flex-wrap">
          {/* Current */}
          <div className="text-center">
            <p className="text-text-muted text-[10px] uppercase tracking-wider mb-2">Current</p>
            {currentSrc ? (
              <img
                src={currentSrc}
                alt={profile.fullName}
                className="w-32 h-32 rounded-md object-cover border border-border-default"
              />
            ) : (
              <div className="w-32 h-32 rounded-md bg-primary-light text-primary flex items-center justify-center text-3xl font-semibold">
                {initialsOf(profile.fullName)}
              </div>
            )}
            {hasStoredPhoto && !currentSrc && (
              <p className="text-text-muted text-[10px] mt-2 max-w-32 break-words">
                A photo is on file ({profile.photoUrl}) but cannot be previewed here.
              </p>
            )}
          </div>

          {/* Pending */}
          {previewUrl && (
            <div className="text-center">
              <p className="text-text-muted text-[10px] uppercase tracking-wider mb-2">New photo</p>
              <img
                src={previewUrl}
                alt="Selected preview"
                className="w-32 h-32 rounded-md object-cover border border-primary/40"
              />
              <p className="text-text-muted text-[10px] mt-1 tabular-nums">
                {(pending ? pending.size / 1024 : 0).toFixed(0)} KB
              </p>
            </div>
          )}

          <div className="flex-1 min-w-56 space-y-3">
            <div>
              <label className="text-text-muted text-[10px] uppercase tracking-wider block mb-1">
                Choose a file
              </label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={(e) => onPick(e.target.files)}
                className="block w-full text-sm text-text-secondary file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border file:border-border-default file:bg-bg-secondary file:text-text-secondary file:text-sm hover:file:bg-bg-hover"
              />
              <p className="text-text-muted text-[10px] mt-1">JPEG or PNG, up to 5 MB.</p>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {cameraSupported ? (
                <button
                  type="button"
                  onClick={cameraOpen ? closeCamera : openCamera}
                  className={`${BTN_SECONDARY} inline-flex items-center gap-1.5`}
                >
                  <Camera size={14} /> {cameraOpen ? 'Close camera' : 'Use camera'}
                </button>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-text-muted text-xs">
                  <VideoOff size={14} /> Camera capture is not available in this browser.
                </span>
              )}
              {pending && (
                <>
                  <button
                    type="button"
                    onClick={() => applyTransform('crop')}
                    disabled={busy}
                    className={`${BTN_SECONDARY} inline-flex items-center gap-1.5`}
                  >
                    <Crop size={14} /> Crop to square (centre)
                  </button>
                  <button
                    type="button"
                    onClick={() => applyTransform('rotate')}
                    disabled={busy}
                    className={`${BTN_SECONDARY} inline-flex items-center gap-1.5`}
                  >
                    <RotateCw size={14} /> Rotate 90°
                  </button>
                  <button
                    type="button"
                    onClick={clearPending}
                    disabled={busy || uploading}
                    className={`${BTN_SECONDARY} inline-flex items-center gap-1.5`}
                  >
                    <Trash2 size={14} /> Discard
                  </button>
                </>
              )}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={upload}
                disabled={!pending || busy || uploading}
                className={`${BTN_PRIMARY} inline-flex items-center gap-1.5`}
              >
                {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                Upload photo
              </button>
              {busy && (
                <span className="inline-flex items-center gap-1.5 text-text-muted text-xs">
                  <Loader2 size={14} className="animate-spin" /> Processing…
                </span>
              )}
            </div>

            <p className="text-text-muted text-xs">
              Automatic face validation is not available — please check the photo manually.
            </p>
          </div>
        </div>

        {/* Camera panel */}
        {cameraOpen && (
          <div className="bg-bg-secondary border border-border-default rounded-md p-4 space-y-3">
            {cameraError && <ErrorBlock message={cameraError} />}
            <video
              ref={videoRef}
              muted
              playsInline
              className="w-full max-w-sm rounded-md bg-bg-hover border border-border-default"
            />
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={capture}
                disabled={busy}
                className={`${BTN_PRIMARY} inline-flex items-center gap-1.5`}
              >
                <Camera size={14} /> Capture
              </button>
              <button type="button" onClick={closeCamera} className={BTN_SECONDARY}>
                Close camera
              </button>
              <span className="text-text-muted text-xs">The camera stops as soon as this panel closes.</span>
            </div>
          </div>
        )}
      </div>
    </SectionCard>
  );
}
