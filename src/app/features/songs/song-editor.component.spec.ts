import { TestBed } from '@angular/core/testing';

import { type Song } from '../../shared/models/song.model';
import { SongEditorComponent } from './song-editor.component';

describe('SongEditorComponent', () => {
  const songOne: Song = {
    id: 'song-1',
    name: 'Pocket Builder',
    tempo: 124,
    beatsPerBar: 4,
    subdivision: 1,
    rhythm: 'straight',
    volume: 0.72,
    createdAt: '2026-05-21T07:00:00.000Z',
    updatedAt: '2026-05-21T07:00:00.000Z',
  };

  const songOneRefreshed: Song = {
    ...songOne,
    name: 'Pocket Builder Server Copy',
    updatedAt: '2026-05-21T07:10:00.000Z',
  };

  const songTwo: Song = {
    id: 'song-2',
    name: 'Triplet Line',
    tempo: 96,
    beatsPerBar: 3,
    subdivision: 3,
    rhythm: 'compound',
    volume: 0.65,
    createdAt: '2026-05-21T07:20:00.000Z',
    updatedAt: '2026-05-21T07:20:00.000Z',
  };

  async function createComponent() {
    await TestBed.configureTestingModule({
      imports: [SongEditorComponent],
    }).compileComponents();

    const fixture = TestBed.createComponent(SongEditorComponent);
    const component = fixture.componentInstance as unknown as {
      nameControl: { value: string; dirty: boolean; setValue(value: string): void; markAsDirty(): void };
    };

    return {
      fixture,
      component,
    };
  }

  it('keeps dirty form values when the same song id is refreshed', async () => {
    const { fixture, component } = await createComponent();

    fixture.componentRef.setInput('song', songOne);
    await fixture.whenStable();

    component.nameControl.setValue('Local Draft Title');
    component.nameControl.markAsDirty();

    fixture.componentRef.setInput('song', songOneRefreshed);
    await fixture.whenStable();

    expect(component.nameControl.value).toBe('Local Draft Title');
    expect(component.nameControl.dirty).toBe(true);
  });

  it('resets the form when a different song id is provided', async () => {
    const { fixture, component } = await createComponent();

    fixture.componentRef.setInput('song', songOne);
    await fixture.whenStable();

    component.nameControl.setValue('Local Draft Title');
    component.nameControl.markAsDirty();

    fixture.componentRef.setInput('song', songTwo);
    await fixture.whenStable();

    expect(component.nameControl.value).toBe(songTwo.name);
  });
});
