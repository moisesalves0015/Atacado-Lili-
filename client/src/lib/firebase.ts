import type { FirebaseStorage } from "firebase/storage";

export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyAIiafsVQkawBZrHVHDvoiZ72eTH0Cfb_U",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "atacadolili.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "atacadolili",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "atacadolili.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "294276300088",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:294276300088:web:1b1c6e19df185b104695cd",
  measurementId: "G-EDNFSBYTHY",
};

let storagePromise: Promise<FirebaseStorage> | null = null;

async function getFirebaseStorage() {
  if (!storagePromise) {
    storagePromise = Promise.all([
      import("firebase/app"),
      import("firebase/storage"),
      import("firebase/auth").catch(() => null),
    ]).then(async ([appSdk, storageSdk, authSdk]) => {
      const app = appSdk.getApps().length ? appSdk.getApp() : appSdk.initializeApp(firebaseConfig);
      if (authSdk) {
        try {
          const auth = authSdk.getAuth(app);
          if (!auth.currentUser) {
            await Promise.race([
              authSdk.signInAnonymously(auth),
              new Promise(resolve => setTimeout(resolve, 1500)),
            ]);
          }
        } catch {
          // Ignore anonymous auth error if disabled in console
        }
      }
      const storage = storageSdk.getStorage(app);
      storage.maxUploadRetryTime = 2500;
      storage.maxOperationRetryTime = 2500;
      return storage;
    });
  }
  return storagePromise;
}

function safeFileName(file: File) {
  const extension = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  return `${crypto.randomUUID()}.${extension}`;
}

function compressImageToDataUrl(file: File, maxDimension = 1200, quality = 0.85): Promise<{ dataUrl: string; blob: Blob }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Não foi possível ler a imagem"));
    reader.onload = () => {
      const rawDataUrl = String(reader.result || "");
      const img = new Image();
      img.onerror = () => {
        resolve({ dataUrl: rawDataUrl, blob: file });
      };
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDimension || height > maxDimension) {
          if (width >= height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve({ dataUrl: rawDataUrl, blob: file });
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        const compressedDataUrl = canvas.toDataURL("image/jpeg", quality);
        canvas.toBlob(
          blob => {
            resolve({ dataUrl: compressedDataUrl, blob: blob || file });
          },
          "image/jpeg",
          quality
        );
      };
      img.src = rawDataUrl;
    };
    reader.readAsDataURL(file);
  });
}

async function uploadToFirebaseWithTimeout(file: File, blob: Blob, timeoutMs = 3000): Promise<string> {
  const uploadTask = (async () => {
    const [storage, storageSdk] = await Promise.all([getFirebaseStorage(), import("firebase/storage")]);
    const storageRef = storageSdk.ref(storage, `products/${safeFileName(file)}`);
    const result = await storageSdk.uploadBytes(storageRef, blob, {
      contentType: blob.type || file.type || "image/jpeg",
      cacheControl: "public,max-age=31536000,immutable",
    });
    return await storageSdk.getDownloadURL(result.ref);
  })();

  const timeoutTask = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("Firebase Storage timeout")), timeoutMs);
  });

  return Promise.race([uploadTask, timeoutTask]);
}

export async function uploadProductPhoto(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Selecione uma imagem válida");
  if (file.size > 15 * 1024 * 1024) throw new Error("A foto precisa ter no máximo 15 MB");

  const { dataUrl, blob } = await compressImageToDataUrl(file);

  // 1. Try uploading to Firebase Storage first (with fast timeout so UI never hangs on CORS/rules)
  try {
    return await uploadToFirebaseWithTimeout(file, blob, 2800);
  } catch (firebaseErr) {
    console.warn("[Upload] Firebase Storage indisponível ou bloqueado por CORS/regras, salvando no servidor local:", firebaseErr);
  }

  // 2. Fallback: save image file on the backend server (/api/upload -> /uploads/<uuid>.jpg)
  try {
    const response = await fetch("/api/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName: file.name, dataUrl }),
    });
    if (response.ok) {
      const data = (await response.json()) as { url?: string };
      if (data?.url) return data.url;
    }
  } catch (serverErr) {
    console.warn("[Upload] Falha no endpoint /api/upload, usando DataURL comprimido:", serverErr);
  }

  // 3. Final fallback: compressed DataURL
  return dataUrl;
}
