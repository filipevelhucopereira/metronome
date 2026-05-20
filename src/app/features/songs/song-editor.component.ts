import { ChangeDetectionStrategy, Component, effect, input, output } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';

import { BEATS_PER_BAR_OPTIONS, DEFAULT_SONG_DRAFT, RHYTHM_OPTIONS, SUBDIVISION_OPTIONS, type RhythmOption, type Song, type SongDraft, type SubdivisionOption } from '../../shared/models/song.model';
import { normalizeMetronomeSettings } from '../../core/metronome/metronome.helpers';

@Component({
  selector: 'app-song-editor',
  imports: [ReactiveFormsModule],
  templateUrl: './song-editor.component.html',
  styleUrl: './song-editor.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SongEditorComponent {
  readonly song = input<Song | null>(null);
  readonly submitLabel = input('Save song');

  readonly saved = output<SongDraft>();
  readonly canceled = output<void>();

  protected readonly beatOptions = BEATS_PER_BAR_OPTIONS;
  protected readonly subdivisionOptions = SUBDIVISION_OPTIONS;
  protected readonly rhythmOptions = RHYTHM_OPTIONS;

  protected readonly form = new FormGroup({
    name: new FormControl(DEFAULT_SONG_DRAFT.name, {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(64)],
    }),
    tempo: new FormControl(DEFAULT_SONG_DRAFT.tempo, {
      nonNullable: true,
      validators: [Validators.required, Validators.min(30), Validators.max(240)],
    }),
    beatsPerBar: new FormControl(DEFAULT_SONG_DRAFT.beatsPerBar, {
      nonNullable: true,
      validators: [Validators.required],
    }),
    subdivision: new FormControl<SubdivisionOption>(DEFAULT_SONG_DRAFT.subdivision, {
      nonNullable: true,
      validators: [Validators.required],
    }),
    rhythm: new FormControl<RhythmOption>(DEFAULT_SONG_DRAFT.rhythm, {
      nonNullable: true,
      validators: [Validators.required],
    }),
    volume: new FormControl(DEFAULT_SONG_DRAFT.volume, {
      nonNullable: true,
      validators: [Validators.required, Validators.min(0), Validators.max(1)],
    }),
  });

  constructor() {
    effect(() => {
      const song = this.song();

      this.form.reset({
        name: song?.name ?? DEFAULT_SONG_DRAFT.name,
        tempo: song?.tempo ?? DEFAULT_SONG_DRAFT.tempo,
        beatsPerBar: song?.beatsPerBar ?? DEFAULT_SONG_DRAFT.beatsPerBar,
        subdivision: song?.subdivision ?? DEFAULT_SONG_DRAFT.subdivision,
        rhythm: song?.rhythm ?? DEFAULT_SONG_DRAFT.rhythm,
        volume: song?.volume ?? DEFAULT_SONG_DRAFT.volume,
      });
    });
  }

  protected updateRhythm(value: RhythmOption): void {
    const normalized = normalizeMetronomeSettings({
      ...this.form.getRawValue(),
      rhythm: value,
    });

    this.form.patchValue({
      subdivision: normalized.subdivision,
      rhythm: normalized.rhythm,
    });
  }

  protected updateSubdivision(value: SubdivisionOption): void {
    const normalized = normalizeMetronomeSettings({
      ...this.form.getRawValue(),
      subdivision: value,
    });

    this.form.patchValue({
      subdivision: normalized.subdivision,
      rhythm: normalized.rhythm,
    });
  }

  protected submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const rawValue = this.form.getRawValue();
    const normalized = normalizeMetronomeSettings(rawValue);

    this.saved.emit({
      name: rawValue.name.trim(),
      tempo: normalized.tempo,
      beatsPerBar: normalized.beatsPerBar,
      subdivision: normalized.subdivision,
      rhythm: normalized.rhythm,
      volume: normalized.volume,
    });
  }

  protected cancel(): void {
    this.canceled.emit();
  }
}
