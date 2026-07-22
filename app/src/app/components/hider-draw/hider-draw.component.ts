import { Component, EventEmitter, Input, Output } from '@angular/core';
import { HiderCardData } from 'src/app/models/hider-card-data';

@Component({
  selector: 'app-hider-draw',
  templateUrl: './hider-draw.component.html',
  styleUrls: ['./hider-draw.component.scss'],
  standalone: false,
})
export class HiderDrawComponent {
  @Input() title = 'Draw';
  @Input() category = 'General';
  @Input() cardsToDraw = 1;
  @Input() cardsTaken = 1;
  @Input() drawnCards: HiderCardData[] = [];
  @Input() deckRemaining = 0;
  @Input() selectable = false;
  @Input() selectedCardIds: string[] = [];
  @Input() disabled = false;
  @Output() cardToggle = new EventEmitter<string>();

  readonly deckBackCard: HiderCardData = {
    id: 'deck-back',
    type: 'BACK',
    title: 'Mazo',
    description: '',
  };

  get pendingCards(): number {
    return Math.max(this.deckRemaining, 0);
  }

  isSelected(cardId: string): boolean {
    return this.selectedCardIds.includes(cardId);
  }

  toggleCard(cardId: string): void {
    if (!this.selectable || this.disabled) {
      return;
    }

    this.cardToggle.emit(cardId);
  }
}
