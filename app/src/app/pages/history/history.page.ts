import { Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { GameEvent, GameNotification, SerializedTimestamp } from '../../models/core-model';
import { GameFacadeService } from '../../services/game-facade';

@Component({
  selector: 'app-history',
  templateUrl: './history.page.html',
  styleUrls: ['./history.page.scss'],
  standalone: false,
})
export class HistoryPage {
  private readonly route = inject(ActivatedRoute);
  private readonly gameFacade = inject(GameFacadeService);

  readonly gameId = (this.route.snapshot.paramMap.get('gameId') ?? '').toUpperCase();
  events: GameEvent[] = [];
  notifications: GameNotification[] = [];
  loading = false;
  errorMessage = '';
  segment: 'events' | 'notifications' = 'events';

  constructor() {
    void this.refresh();
  }

  async refresh(): Promise<void> {
    if (!this.gameId) {
      this.errorMessage = 'Falta gameId.';
      return;
    }

    this.loading = true;
    this.errorMessage = '';
    try {
      const [events, notifications] = await Promise.all([
        this.gameFacade.listGameEvents(this.gameId, 100),
        this.gameFacade.listGameNotifications(this.gameId, 100),
      ]);
      this.events = events;
      this.notifications = notifications;
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : 'No se pudo cargar el historial.';
    } finally {
      this.loading = false;
    }
  }

  formatDate(value: SerializedTimestamp): string {
    const iso = typeof value === 'string' ? value : value?.iso;
    return iso ? new Date(iso).toLocaleString() : '-';
  }

  payloadText(payload: Record<string, unknown>): string {
    const text = JSON.stringify(payload);
    return text === '{}' ? '' : text;
  }
}
