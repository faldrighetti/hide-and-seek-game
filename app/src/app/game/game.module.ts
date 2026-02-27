import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { GamePageRoutingModule } from './game-routing.module';
import { GamePage } from './game.page';

@NgModule({
  imports: [CommonModule, IonicModule, GamePageRoutingModule],
  declarations: [GamePage],
})
export class GamePageModule {}