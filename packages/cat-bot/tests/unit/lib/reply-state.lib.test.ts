import { describe, it, expect } from 'vitest';
import { stateStore } from '@/engine/lib/state.lib.js';

describe('Reply State Store Library', () => {
  const ID = 'msg-123:user-456';
  const DATA = { command: 'reply', state: 'step1', context: { age: 10 } };

  it('should create and retrieve state correctly', () => {
    // WHY: Core memory required to chain conversation steps across async events
    stateStore.create(ID, DATA);
    const retrieved = stateStore.get(ID);

    expect(retrieved).toEqual(DATA);
  });

  it('should delete state correctly', () => {
    // WHY: Teardown prevents old flows from triggering randomly
    stateStore.create(ID, DATA);
    stateStore.delete(ID);

    expect(stateStore.get(ID)).toBeNull();
  });

  it('should return null for non-existent states', () => {
    expect(stateStore.get('unknown-key')).toBeNull();
  });
});
