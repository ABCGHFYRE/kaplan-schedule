import { initializeApp } from 'firebase/app';
import {
  getAuth, connectAuthEmulator, onAuthStateChanged, signInWithEmailAndPassword, signOut,
  setPersistence, browserLocalPersistence,
} from 'firebase/auth';
import {
  initializeFirestore, connectFirestoreEmulator, persistentLocalCache, persistentMultipleTabManager,
  memoryLocalCache, doc, collection, getDoc, setDoc, updateDoc, deleteDoc, addDoc, onSnapshot,
  writeBatch, query, where, orderBy, limit, getDocs, documentId, deleteField, serverTimestamp, FieldPath,
} from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyD57PRDi2GHXHk3ISVdg5lrQDhGDM8Saso',
  authDomain: 'kaplan-schedule.firebaseapp.com',
  projectId: 'kaplan-schedule',
  storageBucket: 'kaplan-schedule.firebasestorage.app',
  messagingSenderId: '552367994082',
  appId: '1:552367994082:web:55542bf231b25a4b33dabb',
};

// The one Firebase account that sits behind the password screen.
export const MANAGER_EMAIL = 'manager@kaplan-schedule.app';

const useEmulator = ['localhost', '127.0.0.1'].includes(location.hostname)
  && new URLSearchParams(location.search).has('emu');

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = initializeFirestore(app, {
  localCache: useEmulator
    ? memoryLocalCache()
    : persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});
if (useEmulator) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}

export async function login(password) {
  await setPersistence(auth, browserLocalPersistence);
  return signInWithEmailAndPassword(auth, MANAGER_EMAIL, password);
}
export const logout = () => signOut(auth);
export { onAuthStateChanged };

export const fs = {
  doc, collection, getDoc, setDoc, updateDoc, deleteDoc, addDoc, onSnapshot, writeBatch, query,
  where, orderBy, limit, getDocs, documentId, deleteField, serverTimestamp, FieldPath,
};
