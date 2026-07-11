import { initializeApp } from "firebase/app";
import {
  collection,
  getDocs,
  getFirestore,
  orderBy,
  query
} from "firebase/firestore";
import { firebaseConfig } from "../../firebase-config.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

export async function fetchPosts() {
  const snapshot = await getDocs(query(collection(db, "posts"), orderBy("date", "desc")));
  return snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
}

export async function fetchRankings() {
  const snapshot = await getDocs(query(collection(db, "rankings"), orderBy("rank", "asc")));
  return snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
}
