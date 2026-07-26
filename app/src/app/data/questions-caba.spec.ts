interface QuestionItem {
  label?: string;
  prompt?: string;
  asunto?: string;
  distanceM?: number | null;
  customDistance?: boolean;
  answerGroups?: Array<{ label: string; options: string[]; optionsByAnswer?: Record<string, string[]> }>;
  endgameOnly?: boolean;
  resolutionMode?: string;
  storesFiles?: boolean;
  storesUrls?: boolean;
}

interface QuestionsFile {
  questions: Record<string, {
    name: string;
    resolutionMode?: string;
    endgameOnly?: boolean;
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
    expect(matchingLabels).not.toContain('4.ª división administrativa (barrio)');
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

  it('includes endgame-only questions with constrained answers', () => {
    const endgame = questionsFile.questions['endgame'];
    const streetDirection = endgame.items.find(item => item.label === 'Dirección de calle/avenida');
    const blockTransit = endgame.items.find(item => item.label === 'Parada o estación en la cuadra');
    const streetType = endgame.items.find(item => item.label === 'Tipo de vía');
    const barrio = endgame.items.find(item => item.label === 'Barrio');

    expect(endgame.endgameOnly).toBeTrue();
    expect(endgame.items.every(item => item.endgameOnly)).toBeTrue();
    expect(endgame.items.map(item => item.label)).toEqual([
      'Dirección de calle/avenida',
      'Parada o estación en la cuadra',
      'Tipo de vía',
      'Barrio',
    ]);
    expect(streetDirection).toBeDefined();
    expect(streetDirection?.answerGroups?.[0].options).toEqual(['diagonal', 'horizontal o vertical']);
    expect(streetDirection?.answerGroups?.[1].optionsByAnswer).toEqual({
      diagonal: ['noreste', 'noroeste', 'sudeste', 'sudoeste', 'doble mano'],
      'horizontal o vertical': ['norte', 'sur', 'este', 'oeste', 'doble mano'],
    });
    expect(blockTransit?.answerGroups?.[0].options).toEqual([
      'Parada de colectivos',
      'Acceso a estación de subte o tren',
      'Ambos',
      'Ninguno',
    ]);
    expect(streetType?.answerGroups?.[0].options).toEqual(['Calle', 'Avenida', 'Otro']);
    expect(barrio?.prompt).toBe('¿Tu estación base está en el mismo barrio en el que estoy parado?');
    expect(barrio?.resolutionMode).toBe('AUTOMATIC');
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
