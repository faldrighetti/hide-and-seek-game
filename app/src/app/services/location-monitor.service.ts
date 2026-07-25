import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, Observable, Subscription, combineLatest } from 'rxjs';
import { GAME_CONFIG } from '../config/game-config';
import { GameBlueprint, PlayerRole } from '../models/core-model';
import { GameFacadeService } from './game-facade';

export interface LocationMonitorState {
  active: boolean;
  permissionState: PermissionState | 'unknown';
  lastError: string | null;
  lastAccuracyM: number | null;
  lastLat: number | null;
  lastLng: number | null;
  lastInsidePlayableArea: boolean | null;
  outsideSinceMillis: number | null;
}

@Injectable({ providedIn: 'root' })
export class LocationMonitorService implements OnDestroy {
  private readonly stateSubject = new BehaviorSubject<LocationMonitorState>({
    active: false,
    permissionState: 'unknown',
    lastError: null,
    lastAccuracyM: null,
    lastLat: null,
    lastLng: null,
    lastInsidePlayableArea: null,
    outsideSinceMillis: null,
  });

  readonly state$ = this.stateSubject.asObservable();

  private watchId: number | null = null;
  private subscription: Subscription | null = null;
  private gameId: string | null = null;
  private latestRole: PlayerRole | null = null;
  private latestBlueprint: GameBlueprint | null = null;
  private outsideSinceMillis: number | null = null;
  private lastSeekerPublishMillis = 0;
  private lastHiderPublishMillis = 0;
  private publishInFlight = false;
  private privatePublishInFlight = false;

  constructor(private readonly gameFacade: GameFacadeService) {}

  start(
    gameId: string,
    role$: Observable<PlayerRole>,
    blueprint$: Observable<GameBlueprint>,
  ): void {
    if (this.gameId === gameId && this.watchId !== null) {
      return;
    }

    this.stop();
    this.gameId = gameId;
    this.subscription = combineLatest([role$, blueprint$]).subscribe(([role, blueprint]) => {
      this.latestRole = role;
      this.latestBlueprint = blueprint;
    });
    void this.refreshPermissionState();

    if (!navigator.geolocation) {
      this.patchState({ lastError: 'Este dispositivo no soporta geolocalizacion.' });
      return;
    }

    this.watchId = navigator.geolocation.watchPosition(
      position => void this.handlePosition(position),
      error => this.handlePositionError(error),
      {
        enableHighAccuracy: true,
        maximumAge: 10_000,
        timeout: 20_000,
      },
    );
    this.patchState({ active: true, lastError: null });
  }

  stop(): void {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
    this.subscription?.unsubscribe();
    this.subscription = null;
    this.gameId = null;
    this.latestRole = null;
    this.latestBlueprint = null;
    this.outsideSinceMillis = null;
    this.patchState({ active: false, outsideSinceMillis: null });
  }

  ngOnDestroy(): void {
    this.stop();
  }

  private async handlePosition(position: GeolocationPosition): Promise<void> {
    const role = this.latestRole;
    const blueprint = this.latestBlueprint;
    const gameId = this.gameId;
    if (!role || !blueprint || !gameId || !role.isParticipant) {
      return;
    }

    const location = {
      lat: position.coords.latitude,
      lng: position.coords.longitude,
    };
    const accuracyM = position.coords.accuracy;
    this.patchState({
      lastAccuracyM: accuracyM,
      lastLat: location.lat,
      lastLng: location.lng,
      lastError: null,
    });

    if (role.isSeeker) {
      await this.publishSeekerLocation(gameId, location.lat, location.lng);
      return;
    }

    if (!role.isHider || (blueprint.currentTurn.phase !== 'ESCAPE' && blueprint.currentTurn.phase !== 'CHASE')) {
      return;
    }

    if (!Number.isFinite(accuracyM)) {
      this.patchState({ lastInsidePlayableArea: null });
      return;
    }

    await this.publishHiderPrivateLocation(gameId, location.lat, location.lng, accuracyM);
  }

  private async publishSeekerLocation(gameId: string, lat: number, lng: number): Promise<void> {
    const now = Date.now();
    if (
      this.publishInFlight ||
      now - this.lastSeekerPublishMillis < GAME_CONFIG.locationPublishThrottleSeconds * 1000
    ) {
      return;
    }

    this.publishInFlight = true;
    try {
      await this.gameFacade.publishSeekerLocation(gameId, lat, lng, false);
      this.lastSeekerPublishMillis = now;
    } catch (error) {
      this.patchState({ lastError: error instanceof Error ? error.message : 'No se pudo publicar ubicacion.' });
    } finally {
      this.publishInFlight = false;
    }
  }

  private async publishHiderPrivateLocation(
    gameId: string,
    lat: number,
    lng: number,
    accuracyM: number,
  ): Promise<void> {
    const now = Date.now();
    if (
      this.privatePublishInFlight ||
      now - this.lastHiderPublishMillis < GAME_CONFIG.locationPublishThrottleSeconds * 1000
    ) {
      return;
    }

    this.privatePublishInFlight = true;
    try {
      const result = await this.gameFacade.publishHiderPrivateLocation(gameId, lat, lng, accuracyM);
      this.lastHiderPublishMillis = now;
      this.patchState({ lastInsidePlayableArea: result.isInsidePlayableArea });

      if (!result.geofenceReliable || result.isInsidePlayableArea) {
        this.outsideSinceMillis = null;
        this.patchState({ outsideSinceMillis: null });
        return;
      }

      this.outsideSinceMillis ??= now;
      this.patchState({ outsideSinceMillis: this.outsideSinceMillis });
    } catch (error) {
      this.patchState({ lastError: error instanceof Error ? error.message : 'No se pudo publicar ubicacion privada.' });
    } finally {
      this.privatePublishInFlight = false;
    }
  }

  private handlePositionError(error: GeolocationPositionError): void {
    this.patchState({
      lastError: error.message || 'No se pudo obtener ubicacion.',
      active: this.watchId !== null,
    });
    void this.refreshPermissionState();
  }

  private async refreshPermissionState(): Promise<void> {
    if (!navigator.permissions?.query) {
      this.patchState({ permissionState: 'unknown' });
      return;
    }

    try {
      const status = await navigator.permissions.query({ name: 'geolocation' });
      this.patchState({ permissionState: status.state });
      status.onchange = () => this.patchState({ permissionState: status.state });
    } catch {
      this.patchState({ permissionState: 'unknown' });
    }
  }

  private patchState(patch: Partial<LocationMonitorState>): void {
    this.stateSubject.next({
      ...this.stateSubject.value,
      ...patch,
    });
  }
}
