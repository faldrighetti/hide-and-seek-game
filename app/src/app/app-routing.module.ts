import { NgModule } from '@angular/core';
import { PreloadAllModules, RouterModule, Routes } from '@angular/router';

const routes: Routes = [
  {
    path: '',
    loadChildren: () => import('./home/home.module').then(m => m.HomePageModule),
  },
  {
    path: 'create',
    loadChildren: () => import('./create/create.module').then(m => m.CreatePageModule),
  },
  {
    path: 'join',
    loadChildren: () => import('./join/join.module').then(m => m.JoinPageModule),
  },
  { 
    path: 'join/:gameId', 
    loadChildren: () => import('./pages/join/join.module').then(m => m.JoinPageModule) 
  },
  {
    path: 'lobby/:gameId',
    loadChildren: () => import('./lobby/lobby.module').then(m => m.LobbyPageModule),
  },
  {
    path: 'game/:gameId',
    loadChildren: () => import('./game/game.module').then(m => m.GamePageModule),
  },
];

@NgModule({
  imports: [RouterModule.forRoot(routes, { preloadingStrategy: PreloadAllModules })],
  exports: [RouterModule],
})
export class AppRoutingModule {}