import { Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { TurnQuestionHistoryItem } from '../../models/core-model';
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
  questions: TurnQuestionHistoryItem[] = [];
  loading = false;
  errorMessage = '';

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
      this.questions = await this.gameFacade.listQuestionHistory(this.gameId, 100);
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : 'No se pudo cargar el historial.';
    } finally {
      this.loading = false;
    }
  }

  formatDate(value: string | null): string {
    return value ? new Date(value).toLocaleString() : '-';
  }

  questionMeta(question: TurnQuestionHistoryItem): string {
    const parts = [this.formatDate(question.createdAtIso)];
    if (question.runNumber !== null) {
      parts.push(`Turno ${question.runNumber}`);
    }
    if (question.categoryId) {
      parts.push(question.categoryId);
    }
    if (question.isPhoto) {
      parts.push('Foto');
    }
    return parts.join(' · ');
  }

  statusColor(question: TurnQuestionHistoryItem): string {
    if (question.status === 'PENDING') {
      return 'warning';
    }
    if (question.status === 'EXPIRED' || question.resolution === 'TIMEOUT') {
      return 'danger';
    }
    return 'success';
  }

  statusLabel(question: TurnQuestionHistoryItem): string {
    if (question.status === 'PENDING') {
      return 'Pendiente';
    }
    if (question.resolution === 'ANSWER') {
      return 'Respondida';
    }
    if (question.resolution === 'VETO') {
      return 'Vetada';
    }
    if (question.resolution === 'RANDOMIZE') {
      return 'Randomizada';
    }
    if (question.resolution === 'TIMEOUT' || question.status === 'EXPIRED') {
      return 'Vencida';
    }
    return 'Resuelta';
  }

  answerLabel(question: TurnQuestionHistoryItem): string {
    if (question.status === 'PENDING') {
      return 'Todavía no respondida.';
    }
    if (question.resolution === 'ANSWER') {
      return question.answerText?.trim() || 'Respuesta registrada sin texto.';
    }
    if (question.resolution === 'VETO') {
      return 'El escondido usó Veto.';
    }
    if (question.resolution === 'RANDOMIZE') {
      return 'El escondido usó Randomizar.';
    }
    if (question.resolution === 'TIMEOUT' || question.status === 'EXPIRED') {
      return 'Se venció sin respuesta.';
    }
    return 'Sin respuesta registrada.';
  }
}
