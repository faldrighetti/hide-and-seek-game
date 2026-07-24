import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { IonicModule } from '@ionic/angular';
import { RulesPageRoutingModule } from './rules-routing.module';
import { RulesPage } from './rules.page';

@NgModule({
  imports: [CommonModule, IonicModule, RulesPageRoutingModule],
  declarations: [RulesPage],
})
export class RulesPageModule {}
