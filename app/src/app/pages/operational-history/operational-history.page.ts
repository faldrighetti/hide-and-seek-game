import { Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { GameEvent, SerializedTimestamp, TurnQuestionHistoryItem } from '../../models/core-model';
import { GameFacadeService } from '../../services/game-facade';

type HistoryView = 'ACTIVITY' | 'QUESTIONS';
type EventCategory = 'ALL' | 'GAME' | 'TURN' | 'QUESTIONS' | 'CARDS' | 'CAPTURE' | 'INCIDENTS';
type QuestionStatusFilter = 'ALL' | 'PENDING' | 'RESOLVED' | 'EXPIRED';

@Component({
  selector: 'app-operational-history',
  templateUrl: './operational-history.page.html',
  styleUrls: ['./operational-history.page.scss'],
  standalone: false,
})
export class OperationalHistoryPage {
  private readonly route = inject(ActivatedRoute);
  private readonly gameFacade = inject(GameFacadeService);

  readonly gameId = (this.route.snapshot.paramMap.get('gameId') ?? '').toUpperCase();
  readonly eventCategories: Array<{ value: EventCategory; label: string }> = [
    { value: 'ALL', label: 'Todo' },
    { value: 'GAME', label: 'Partida' },
    { value: 'TURN', label: 'Turnos y fases' },
    { value: 'QUESTIONS', label: 'Preguntas' },
    { value: 'CARDS', label: 'Cartas' },
    { value: 'CAPTURE', label: 'Endgame y captura' },
    { value: 'INCIDENTS', label: 'Operación e incidentes' },
  ];
  events: GameEvent[] = [];
  questions: TurnQuestionHistoryItem[] = [];
  view: HistoryView = 'ACTIVITY';
  eventCategory: EventCategory = 'ALL';
  selectedRun: number | 'ALL' = 'ALL';
  questionStatus: QuestionStatusFilter = 'ALL';
  loading = false;
  errorMessage = '';

  constructor() { void this.refresh(); }

  get availableRuns(): number[] {
    const runs = [...this.events.map(event => event.runNumber), ...this.questions.map(question => question.runNumber)]
      .filter((run): run is number => typeof run === 'number');
    return [...new Set(runs)].sort((left, right) => right - left);
  }

  get filteredEvents(): GameEvent[] {
    return this.events.filter(event =>
      (this.eventCategory === 'ALL' || this.eventCategoryFor(event.type) === this.eventCategory)
      && (this.selectedRun === 'ALL' || event.runNumber === this.selectedRun));
  }

  get filteredQuestions(): TurnQuestionHistoryItem[] {
    return this.questions.filter(question => {
      const runMatches = this.selectedRun === 'ALL' || question.runNumber === this.selectedRun;
      const statusMatches = this.questionStatus === 'ALL'
        || (this.questionStatus === 'PENDING' && question.status === 'PENDING')
        || (this.questionStatus === 'EXPIRED' && (question.status === 'EXPIRED' || question.resolution === 'TIMEOUT'))
        || (this.questionStatus === 'RESOLVED' && question.status === 'RESOLVED' && question.resolution !== 'TIMEOUT');
      return runMatches && statusMatches;
    });
  }

  async refresh(): Promise<void> {
    if (!this.gameId) { this.errorMessage = 'Falta gameId.'; return; }
    this.loading = true;
    this.errorMessage = '';
    try {
      [this.events, this.questions] = await Promise.all([
        this.gameFacade.listOperationalHistory(this.gameId, 200),
        this.gameFacade.listQuestionHistory(this.gameId, 200),
      ]);
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : 'No se pudo cargar el historial.';
    } finally {
      this.loading = false;
    }
  }

  setView(value: unknown): void {
    if (value === 'ACTIVITY' || value === 'QUESTIONS') this.view = value;
  }

  eventTitle(event: GameEvent): string {
    const labels: Record<string, string> = {
      GAME_STARTED: 'Partida iniciada', GAME_PAUSED: 'Partida pausada', GAME_RESUMED: 'Partida reanudada',
      GAME_CANCELED: 'Partida finalizada', EMERGENCY_DECLARED: 'Emergencia declarada', TURN_STARTED: 'Turno iniciado',
      TURN_ENDED_MANUALLY: 'Turno finalizado', TURN_ENDED_BY_TIMEOUT: 'Turno finalizado por tiempo',
      PHASE_ADVANCED: 'Cambio de fase', BASE_STATION_CONFIRMED: 'Estación base confirmada',
      QUESTION_SENT: 'Pregunta enviada', QUESTION_RESOLVED: 'Pregunta resuelta', QUESTION_EXPIRED: 'Pregunta vencida',
      LOOT_SELECTED: 'Loot resuelto', CURSE_PLAYED: 'Maldición activada', CURSE_COMPLETED: 'Maldición completada',
      DISCARD_DRAW_POWERUP_PLAYED: 'Carta de poder utilizada', DUPLICATE_POWERUP_PLAYED: 'Carta duplicada',
      MOVE_STARTED: 'SALÍ DE AHÍ iniciado', MOVE_COMPLETED: 'SALÍ DE AHÍ completado',
      ENDGAME_VERIFIED_ACTIVE: 'Endgame activado', ENDGAME_QUESTIONS_CONSULTED: 'Consulta de endgame enviada',
      ENDGAME_CONSULTATION_CONFIRMED: 'Endgame confirmado', ENDGAME_CONSULTATION_REJECTED: 'Endgame rechazado',
      CAPTURE_ATTEMPT_STARTED: 'Intento de captura', CAPTURE_CONFIRMED_BY_HIDER: 'Captura confirmada por el escondido',
      CAPTURE_REJECTED_BY_HIDER: 'Captura rechazada por el escondido',
      CAPTURE_CONFIRMED_BY_SEEKERS: 'Captura confirmada por buscadores',
      CAPTURE_RATIFIED_BY_SEEKER: 'Captura ratificada por un buscador',
      THERMOMETER_ACTIVATED: 'Termómetro activado', THERMOMETER_COMPLETED: 'Termómetro completado',
      PLAYER_TEMPORARILY_DISCONNECTED: 'Jugador desconectado temporalmente', PLAYER_RECONNECTED: 'Jugador reconectado',
    };
    return labels[event.type] ?? event.type.toLowerCase().replace(/_/g, ' ').replace(/^./, (letter: string) => letter.toUpperCase());
  }

  eventDetail(event: GameEvent): string {
    if (event.type === 'QUESTION_SENT') return String(event.payload['prompt'] ?? 'Se registró una pregunta.');
    if (event.type === 'QUESTION_RESOLVED') return `Resolución: ${this.resolutionLabel(String(event.payload['resolution'] ?? 'ANSWER'))}.`;
    if (event.type === 'PHASE_ADVANCED') return `${this.phaseLabel(event.payload['fromPhase'])} → ${this.phaseLabel(event.payload['toPhase'])}`;
    return event.actorTeamId ? `Acción registrada por el Equipo ${event.actorTeamId}.` : 'Evento registrado por el sistema.';
  }

  eventMeta(event: GameEvent): string {
    const parts = [this.formatTimestamp(event.createdAt)];
    if (event.runNumber !== null) parts.push(`Turno ${event.runNumber}`);
    if (event.phase) parts.push(this.phaseLabel(event.phase));
    return parts.join(' · ');
  }

  eventColor(type: string): string {
    const category = this.eventCategoryFor(type);
    if (category === 'INCIDENTS') return type === 'GAME_RESUMED' || type === 'PLAYER_RECONNECTED' ? 'success' : 'warning';
    if (category === 'CAPTURE') return 'danger';
    if (category === 'QUESTIONS') return 'primary';
    if (category === 'CARDS') return 'tertiary';
    if (category === 'TURN') return 'secondary';
    return 'medium';
  }

  eventCategoryLabel(type: string): string {
    const category = this.eventCategoryFor(type);
    return this.eventCategories.find(option => option.value === category)?.label ?? 'Partida';
  }

  formatDate(value: string | null): string { return value ? new Date(value).toLocaleString() : '-'; }

  questionMeta(question: TurnQuestionHistoryItem): string {
    const parts = [this.formatDate(question.createdAtIso)];
    if (question.runNumber !== null) parts.push(`Turno ${question.runNumber}`);
    if (question.categoryId) parts.push(question.categoryId);
    if (question.isPhoto) parts.push('Foto');
    return parts.join(' · ');
  }

  statusColor(question: TurnQuestionHistoryItem): string {
    if (question.status === 'PENDING') return 'warning';
    return question.status === 'EXPIRED' || question.resolution === 'TIMEOUT' ? 'danger' : 'success';
  }

  statusLabel(question: TurnQuestionHistoryItem): string {
    if (question.status === 'PENDING') return 'Pendiente';
    if (question.resolution === 'ANSWER') return 'Respondida';
    if (question.resolution === 'VETO') return 'Vetada';
    if (question.resolution === 'RANDOMIZE') return 'Randomizada';
    if (question.resolution === 'TIMEOUT' || question.status === 'EXPIRED') return 'Vencida';
    return 'Resuelta';
  }

  answerLabel(question: TurnQuestionHistoryItem): string {
    if (question.status === 'PENDING') return 'Todavía no respondida.';
    if (question.resolution === 'ANSWER') return question.answerText?.trim() || 'Respuesta registrada sin texto.';
    if (question.resolution === 'VETO') return 'El escondido usó Veto.';
    if (question.resolution === 'RANDOMIZE') return 'El escondido usó Randomizar.';
    if (question.resolution === 'TIMEOUT' || question.status === 'EXPIRED') return 'Se venció sin respuesta.';
    return 'Sin respuesta registrada.';
  }

  private eventCategoryFor(type: string): Exclude<EventCategory, 'ALL'> {
    if (type.startsWith('QUESTION_') || type.startsWith('THERMOMETER_')) return 'QUESTIONS';
    if (type.startsWith('CAPTURE_') || type.startsWith('ENDGAME_')) return 'CAPTURE';
    if (type.includes('CURSE') || type.includes('POWERUP') || type.startsWith('LOOT_') || type.startsWith('MOVE_')) return 'CARDS';
    if (type.startsWith('TURN_') || type === 'PHASE_ADVANCED' || type === 'BASE_STATION_CONFIRMED') return 'TURN';
    if (type === 'GAME_PAUSED' || type === 'GAME_RESUMED' || type === 'EMERGENCY_DECLARED' || type.startsWith('PLAYER_')) return 'INCIDENTS';
    return 'GAME';
  }

  private formatTimestamp(value: SerializedTimestamp): string {
    if (typeof value === 'string') return new Date(value).toLocaleString();
    if (value && typeof value === 'object') {
      if (value.iso) return new Date(value.iso).toLocaleString();
      if (typeof value.millis === 'number') return new Date(value.millis).toLocaleString();
    }
    return '-';
  }

  private phaseLabel(value: unknown): string {
    const labels: Record<string, string> = { INTERMISSION: 'Preparación', ESCAPE: 'Escape', CHASE: 'Búsqueda', ENDED: 'Finalizada' };
    const phase = String(value ?? '');
    return labels[phase] ?? (phase || 'Sin fase');
  }

  private resolutionLabel(value: string): string {
    const labels: Record<string, string> = { ANSWER: 'respondida', VETO: 'vetada', RANDOMIZE: 'randomizada', TIMEOUT: 'vencida' };
    return labels[value] ?? value.toLowerCase();
  }
}
