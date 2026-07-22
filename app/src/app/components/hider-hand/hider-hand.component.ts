import { Component, EventEmitter, Input, Output } from '@angular/core';
import { HiderCardData } from 'src/app/models/hider-card-data';

@Component({
  selector: 'app-hider-hand',
  templateUrl: './hider-hand.component.html',
  styleUrls: ['./hider-hand.component.scss'],
  standalone: false
})
export class HiderHandComponent {
  @Input() title = 'Mano';
  @Input() cards: HiderCardData[] = [];
  @Input() selectable = false;
  @Input() selectedCardIds: string[] = [];
  @Input() disabled = false;
  @Output() cardToggle = new EventEmitter<string>();

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
