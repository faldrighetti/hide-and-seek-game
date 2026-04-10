import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { HiderCardComponent } from './hider-card/hider-card.component';
import { HiderDrawComponent } from './hider-draw/hider-draw.component';
import { HiderHandComponent } from './hider-hand/hider-hand.component';

@NgModule({
  declarations: [HiderCardComponent, HiderDrawComponent, HiderHandComponent],
  imports: [CommonModule, IonicModule],
  exports: [
    HiderCardComponent,
    HiderDrawComponent,
    HiderHandComponent,
  ],
})
export class HiderUiModule {}