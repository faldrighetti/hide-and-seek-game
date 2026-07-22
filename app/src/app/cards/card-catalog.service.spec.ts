import { validateCardsCatalog } from './card-catalog.service';

describe('validateCardsCatalog', () => {
  it('defaults missing enabled to true and filters disabled cards', () => {
    const result = validateCardsCatalog({
      maldiciones: [
        { id: 1, nombre: 'A', texto_ui: { efecto: 'Desc' } },
        { id: 2, nombre: 'B', enabled: false, texto_ui: { efecto: 'Desc' } },
      ],
    });

    expect(result.cards.length).toBe(2);
    expect(result.enabledCards.map(card => card.id)).toEqual(['curse_1']);
  });

  it('normalizes frontend catalog ids to backend deck ids', () => {
    const result = validateCardsCatalog({
      mazo: {
        mazo_escondedor: {
          bonus_tiempo: [{ color: 'Rojo', minutos: 3, cantidad: 1 }],
          powerups: [{ id: 'veto', nombre: 'Veto', cantidad: 1, pista_reglas: 'Desc' }],
        },
      },
      maldiciones: [{ id: 1, nombre: 'A', texto_ui: { efecto: 'Desc' } }],
    });

    expect(result.deckCards.map(card => card.id)).toEqual([
      'time_bonus_red_3m#1',
      'powerup_veto#1',
      'curse_1#1',
    ]);
  });

  it('reports duplicate ids and declared curse count mismatch', () => {
    const result = validateCardsCatalog({
      mazo: { mazo_escondedor: { cantidad_maldiciones_en_mazo: 3 } },
      maldiciones: [
        { id: 1, nombre: 'A', texto_ui: { efecto: 'Desc' } },
        { id: 1, nombre: 'B', texto_ui: { efecto: 'Desc' } },
      ],
    });

    expect(result.issues.some(issue => issue.message.includes('Duplicate card id'))).toBeTrue();
    expect(result.issues.some(issue => issue.message.includes('Declared curse count'))).toBeTrue();
  });
});
