interface QuestionItem {
  label?: string;
  asunto?: string;
  distanceM?: number | null;
  customDistance?: boolean;
  resolutionMode?: string;
  storesFiles?: boolean;
  storesUrls?: boolean;
}

interface QuestionsFile {
  questions: Record<string, {
    name: string;
    resolutionMode?: string;
    photoHandling?: string;
    metadataOnly?: string[];
    items: QuestionItem[];
  }>;
}

describe('Preguntas_CABA', () => {
  let questionsFile: QuestionsFile;

  beforeAll(async () => {
    const response = await fetch('assets/questions/Preguntas_CABA.json');
    questionsFile = await response.json() as QuestionsFile;
  });

  it('removes questions that are out of scope', () => {
    const matchingLabels = questionsFile.questions['matching'].items.map(item => item.label);
    const measuringLabels = questionsFile.questions['measuring'].items.map(item => item.label);

    expect(matchingLabels).not.toContain('1.ª división administrativa (provincia)');
    expect(matchingLabels).not.toContain('2.ª división administrativa (partido)');
    expect(matchingLabels).not.toContain('Comisaría');
    expect(measuringLabels).not.toContain('Línea de subte');
    expect(measuringLabels).not.toContain('Línea de trenes');
    expect(measuringLabels).not.toContain('Río de la Plata');
    expect(measuringLabels).toContain('General Paz');
    expect(measuringLabels).toContain('Riachuelo');
  });

  it('uses the Spanish visible name for thermometers', () => {
    expect(questionsFile.questions['thermometer'].name).toBe('Termómetros');
  });

  it('normalizes thermometer options to meters', () => {
    expect(questionsFile.questions['thermometer'].items.map(item => item.distanceM)).toEqual([100, 200, 500, 1000, 2000]);
  });

  it('normalizes radar options to meters including custom distance', () => {
    expect(questionsFile.questions['radar'].items.map(item => item.distanceM)).toEqual([500, 1000, 2000, 5000, null]);
    expect(questionsFile.questions['radar'].items[4].customDistance).toBeTrue();
  });

  it('marks photos as external metadata without file storage', () => {
    const photos = questionsFile.questions['photos'];

    expect(photos.resolutionMode).toBe('EXTERNAL_PHOTO');
    expect(photos.photoHandling).toBe('WHATSAPP_EXTERNAL');
    expect(photos.metadataOnly).toEqual([
      'question',
      'timer',
      'sentExternally',
      'sentAt',
      'receivedExternally',
      'receivedAt',
      'validatedBy',
      'validity',
      'resolved',
    ]);
    expect(photos.items.every(item => item.resolutionMode === 'EXTERNAL_PHOTO')).toBeTrue();
    expect(photos.items.every(item => item.storesFiles === false && item.storesUrls === false)).toBeTrue();
  });
});
