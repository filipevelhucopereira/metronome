import { Routes } from '@angular/router';

export const routes: Routes = [
	{
		path: '',
		loadComponent: () => import('./features/player/metronome-player.component').then((module) => module.MetronomePlayerComponent),
		title: 'Metronome',
	},
	{
		path: 'songs',
		loadComponent: () => import('./features/songs/song-library.component').then((module) => module.SongLibraryComponent),
		title: 'Song Library',
	},
	{
		path: 'setlists',
		loadComponent: () => import('./features/setlists/setlist-list.component').then((module) => module.SetlistListComponent),
		title: 'Setlists',
	},
	{
		path: 'setlists/:id',
		loadComponent: () => import('./features/setlists/setlist-detail.component').then((module) => module.SetlistDetailComponent),
		title: 'Setlist Details',
	},
	{
		path: '**',
		redirectTo: '',
	},
];
