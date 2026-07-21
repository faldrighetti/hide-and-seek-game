import { Component, Input } from '@angular/core';
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

  readonly deckBackCard: HiderCardData = {
    id: 'deck-back',
    type: 'BACK',
    title: 'Mazo',
    description: '',
  };

  get pendingCards(): number {
    return Math.max(this.deckRemaining, 0);
  }
}
