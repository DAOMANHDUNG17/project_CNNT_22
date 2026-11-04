import { describe, expect, it, vi } from 'vitest';
import { chartCount, integer, validThreshold } from '../../src/lib/format';
import { parsePending } from '../../src/lib/pendingMovement';
import { movementDeadline, OutcomeUnknownError } from '../../src/lib/api';

describe('exact warehouse numbers',()=>{
  it('keeps bigint values exact instead of rounding through Number',()=>{
    expect(integer('9223372036854775807').replace(/\D/gu,'')).toBe('9223372036854775807');
    expect(validThreshold('9223372036854775807')).toBe(true);
    expect(validThreshold('9223372036854775808')).toBe(false);
    expect(validThreshold('01')).toBe(false);
    expect(validThreshold('-1')).toBe(false);
  });
  it('refuses unsafe chart count conversion',()=>{
    expect(chartCount('9007199254740991')).toBe(9007199254740991);
    expect(chartCount('9007199254740992')).toBe(null);
  });
});
const action={createdAt:'2026-11-04T00:00:00Z',payload:{transaction_id:'72a91ad0-b43a-416c-9ef2-28e16ca604c1',scan_point_id:'SCAN01',scan_code:'PEN',movement_type:'IN',quantity_packages:2}};
describe('pending movement recovery',()=>{
  it('restores the exact UUID and payload after reload',()=>{expect(parsePending(JSON.stringify(action))).toEqual(action);});
  it('rejects corrupt or unsupported persisted actions',()=>{
    for(const raw of ['bad JSON','null',JSON.stringify({...action,payload:{...action.payload,quantity_packages:1.5}}),JSON.stringify({...action,payload:{...action.payload,transaction_id:'not-a-uuid'}}),JSON.stringify({...action,payload:{...action.payload,user_id:'1'}})])expect(parsePending(raw)).toBe(null);
  });
  it('a deadline never silently resubmits or invents a second UUID',async()=>{
    vi.useFakeTimers();
    const commit=vi.fn(()=>new Promise<string>(resolve=>setTimeout(()=>resolve('committed'),2000)));
    const pending=movementDeadline(commit(),1000);
    const assertion=expect(pending).rejects.toBeInstanceOf(OutcomeUnknownError);
    await vi.advanceTimersByTimeAsync(1000); await assertion;
    await vi.advanceTimersByTimeAsync(1000); expect(commit).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
