import { Injectable } from '@angular/core';
import { initializeApp, FirebaseApp } from 'firebase/app';
import {
  Auth,
  GoogleAuthProvider,
  User,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import {
  Firestore,
  collection,
  doc,
  getFirestore,
  onSnapshot,
  query,
  Unsubscribe,
} from 'firebase/firestore';
import { Functions, getFunctions, httpsCallable } from 'firebase/functions';
import { BehaviorSubject, Observable } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class FirebaseGameClientService {
  private readonly app: FirebaseApp = initializeApp(environment.firebase);
  private readonly auth: Auth = getAuth(this.app);
  private readonly firestore: Firestore = getFirestore(this.app);
  private readonly functions: Functions = getFunctions(this.app);
  private readonly userSubject = new BehaviorSubject<User | null>(this.auth.currentUser);
  readonly user$ = this.userSubject.asObservable();

  constructor() {
    onAuthStateChanged(this.auth, user => this.userSubject.next(user));
  }

  async signInWithGoogle(): Promise<User> {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    const credential = await signInWithPopup(this.auth, provider);
    return credential.user;
  }

  async signOut(): Promise<void> {
    await firebaseSignOut(this.auth);
  }

  requireCurrentUser(): User {
    if (this.auth.currentUser) {
      return this.auth.currentUser;
    }

    throw new Error('Tenés que entrar con Google para jugar.');
  }

  async callFunction<TRequest extends object, TResponse>(name: string, data: TRequest): Promise<TResponse> {
    this.requireCurrentUser();
    const callable = httpsCallable<TRequest, TResponse>(this.functions, name);
    const result = await callable(data);
    return result.data;
  }

  gameDoc$(gameId: string): Observable<Record<string, unknown> | null> {
    return new Observable(subscriber => {
      let unsubscribe: Unsubscribe | null = null;

      try {
        this.requireCurrentUser();
        unsubscribe = onSnapshot(
          doc(this.firestore, `games/${gameId}`),
          snapshot => subscriber.next(snapshot.exists() ? snapshot.data() : null),
          error => subscriber.error(error),
        );
      } catch (error) {
        subscriber.error(error);
      }

      return () => unsubscribe?.();
    });
  }

  seats$(gameId: string): Observable<Array<Record<string, unknown> & { id: string }>> {
    return new Observable(subscriber => {
      let unsubscribe: Unsubscribe | null = null;

      try {
        this.requireCurrentUser();
        unsubscribe = onSnapshot(
          query(collection(this.firestore, `games/${gameId}/seats`)),
          snapshot => subscriber.next(snapshot.docs.map(seat => ({ id: seat.id, ...seat.data() }))),
          error => subscriber.error(error),
        );
      } catch (error) {
        subscriber.error(error);
      }

      return () => unsubscribe?.();
    });
  }

  questionDoc$(gameId: string, questionId: string): Observable<(Record<string, unknown> & { id: string }) | null> {
    return new Observable(subscriber => {
      let unsubscribe: Unsubscribe | null = null;

      try {
        this.requireCurrentUser();
        unsubscribe = onSnapshot(
          doc(this.firestore, `games/${gameId}/questions/${questionId}`),
          snapshot => subscriber.next(snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null),
          error => subscriber.error(error),
        );
      } catch (error) {
        subscriber.error(error);
      }

      return () => unsubscribe?.();
    });
  }
}
