import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { GAME_CONFIG } from '../../config/game-config';

export interface SeekerLocationReferenceState {
  active: boolean;
  lastError: string | null;
  lastLat: number | null;
  lastLng: number | null;
  lastAccuracyM: number | null;
  updatedAtIso: string | null;
}

@Injectable({ providedIn: 'root' })
export class SeekerLocationReferenceService implements OnDestroy {
  private readonly stateSubject = new BehaviorSubject<SeekerLocationReferenceState>({
    active: false,
    lastError: null,
    lastLat: null,
    lastLng: null,
    lastAccuracyM: null,
    updatedAtIso: null,
  });

  readonly state$ = this.stateSubject.asObservable();

  private intervalId: number | null = null;
  private requestInFlight = false;

  start(): void {
    if (this.intervalId !== null) {
      return;
    }
    if (!navigator.geolocation) {
      this.patchState({ lastError: 'Este dispositivo no soporta geolocalizacion.' });
      return;
    }

    this.patchState({ active: true, lastError: null });
    this.refresh();
    this.intervalId = window.setInterval(
      () => this.refresh(),
      GAME_CONFIG.locationPublishThrottleSeconds * 1000,
    );
  }

  stop(): void {
    if (this.intervalId !== null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.patchState({ active: false });
  }

  ngOnDestroy(): void {
    this.stop();
  }

  setManualReference(lat: number, lng: number): void {
    this.patchState({
      lastLat: lat,
      lastLng: lng,
      lastAccuracyM: null,
      updatedAtIso: new Date().toISOString(),
      lastError: null,
    });
  }

  private refresh(): void {
    if (this.requestInFlight || !navigator.geolocation) {
      return;
    }

    this.requestInFlight = true;
    navigator.geolocation.getCurrentPosition(
      position => {
        this.requestInFlight = false;
        this.patchState({
          lastLat: position.coords.latitude,
          lastLng: position.coords.longitude,
          lastAccuracyM: position.coords.accuracy,
          updatedAtIso: new Date(position.timestamp).toISOString(),
          lastError: null,
        });
      },
      error => {
        this.requestInFlight = false;
        this.patchState({ lastError: error.message || 'No se pudo obtener ubicacion.' });
      },
      {
        enableHighAccuracy: true,
        maximumAge: GAME_CONFIG.locationPublishThrottleSeconds * 1000,
        timeout: 20_000,
      },
    );
  }

  private patchState(patch: Partial<SeekerLocationReferenceState>): void {
    this.stateSubject.next({
      ...this.stateSubject.value,
      ...patch,
    });
  }
}
