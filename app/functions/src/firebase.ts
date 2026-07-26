import {initializeApp} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";
import {setGlobalOptions} from "firebase-functions/v2";

initializeApp();
setGlobalOptions({maxInstances: 10});

export const db = getFirestore();
