import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { MapGeneratorPage } from './map-generator.page';

const routes: Routes = [{ path: '', component: MapGeneratorPage }];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class MapGeneratorRoutingModule {}
