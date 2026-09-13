import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export interface SeekerLocationReferenceState {
  active: boolean;
  lastError: string | null;
  lastLat: number | null;
  lastLng: number | null;
  updatedAtIso: string | null;
}

@Injectable({ providedIn: 'root' })
export class SeekerLocationReferenceService {
  private readonly stateSubject = new BehaviorSubject<SeekerLocationReferenceState>({
    active: false,
    lastError: null,
    lastLat: null,
    lastLng: null,
    updatedAtIso: null,
  });

  readonly state$ = this.stateSubject.asObservable();

  setManualReference(lat: number, lng: number): void {
    this.patchState({
      lastLat: lat,
      lastLng: lng,
      updatedAtIso: new Date().toISOString(),
      lastError: null,
    });
  }

  private patchState(patch: Partial<SeekerLocationReferenceState>): void {
    this.stateSubject.next({
      ...this.stateSubject.value,
      ...patch,
    });
  }
}
