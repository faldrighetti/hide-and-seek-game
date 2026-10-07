import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NgModule } from '@angular/core';
import { RouterModule } from '@angular/router';
import { IonicModule } from '@ionic/angular';
import { OperationalHistoryPage } from './operational-history.page';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    RouterModule.forChild([{ path: '', component: OperationalHistoryPage }]),
  ],
  declarations: [OperationalHistoryPage],
})
export class OperationalHistoryPageModule {}
