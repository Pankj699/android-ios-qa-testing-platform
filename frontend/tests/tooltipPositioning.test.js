import { describe, it } from 'node:test';
import assert from 'node:assert';
import { calculateTooltipPosition, TOOLTIP_PADDING, DEFAULT_SIDE_OFFSET } from '../src/utils/tooltipPosition.js';

describe('Tooltip Positioning & Boundary Calculations Suite', () => {
  const defaultViewport = { width: 1200, height: 800 };
  const defaultTooltip = { width: 100, height: 30 };

  describe('1. Standard Side Calculations', () => {
    it('positions tooltip on "top" of trigger centered horizontally', () => {
      const trigger = { top: 200, bottom: 240, left: 500, right: 550, width: 50, height: 40 };
      const res = calculateTooltipPosition(trigger, defaultTooltip, defaultViewport, { side: 'top' });

      assert.strictEqual(res.actualSide, 'top');
      // top = trigger.top - sideOffset(8) - tooltip.height(30) = 200 - 8 - 30 = 162
      assert.strictEqual(res.top, 162);
      // left = trigger.left(500) + trigger.width/2(25) - tooltip.width/2(50) = 475
      assert.strictEqual(res.left, 475);
    });

    it('positions tooltip on "bottom" of trigger centered horizontally', () => {
      const trigger = { top: 200, bottom: 240, left: 500, right: 550, width: 50, height: 40 };
      const res = calculateTooltipPosition(trigger, defaultTooltip, defaultViewport, { side: 'bottom' });

      assert.strictEqual(res.actualSide, 'bottom');
      // top = trigger.bottom(240) + sideOffset(8) = 248
      assert.strictEqual(res.top, 248);
      assert.strictEqual(res.left, 475);
    });

    it('positions tooltip on "right" of trigger centered vertically (used by collapsed sidebar)', () => {
      const trigger = { top: 150, bottom: 190, left: 10, right: 50, width: 40, height: 40 };
      const res = calculateTooltipPosition(trigger, defaultTooltip, defaultViewport, { side: 'right' });

      assert.strictEqual(res.actualSide, 'right');
      // left = trigger.right(50) + sideOffset(8) = 58
      assert.strictEqual(res.left, 58);
      // top = trigger.top(150) + trigger.height/2(20) - tooltip.height/2(15) = 155
      assert.strictEqual(res.top, 155);
    });

    it('positions tooltip on "left" of trigger centered vertically', () => {
      const trigger = { top: 150, bottom: 190, left: 300, right: 340, width: 40, height: 40 };
      const res = calculateTooltipPosition(trigger, defaultTooltip, defaultViewport, { side: 'left' });

      assert.strictEqual(res.actualSide, 'left');
      // left = trigger.left(300) - sideOffset(8) - tooltip.width(100) = 192
      assert.strictEqual(res.left, 192);
      assert.strictEqual(res.top, 155);
    });
  });

  describe('2. Viewport Boundary Flipping', () => {
    it('flips from "top" to "bottom" when trigger is near top edge of viewport', () => {
      const nearTopTrigger = { top: 10, bottom: 50, left: 500, right: 550, width: 50, height: 40 };
      const res = calculateTooltipPosition(nearTopTrigger, defaultTooltip, defaultViewport, { side: 'top' });

      assert.strictEqual(res.actualSide, 'bottom');
      assert.strictEqual(res.top, nearTopTrigger.bottom + DEFAULT_SIDE_OFFSET);
    });

    it('flips from "bottom" to "top" when trigger is near bottom edge of viewport', () => {
      const nearBottomTrigger = { top: 760, bottom: 795, left: 500, right: 550, width: 50, height: 35 };
      const res = calculateTooltipPosition(nearBottomTrigger, defaultTooltip, defaultViewport, { side: 'bottom' });

      assert.strictEqual(res.actualSide, 'top');
      assert.strictEqual(res.top, nearBottomTrigger.top - DEFAULT_SIDE_OFFSET - defaultTooltip.height);
    });

    it('flips from "right" to "left" when trigger is near right edge of viewport', () => {
      const nearRightTrigger = { top: 200, bottom: 240, left: 1150, right: 1190, width: 40, height: 40 };
      const res = calculateTooltipPosition(nearRightTrigger, defaultTooltip, defaultViewport, { side: 'right' });

      assert.strictEqual(res.actualSide, 'left');
      assert.strictEqual(res.left, nearRightTrigger.left - DEFAULT_SIDE_OFFSET - defaultTooltip.width);
    });

    it('flips from "left" to "right" when trigger is near left edge of viewport', () => {
      const nearLeftTrigger = { top: 200, bottom: 240, left: 10, right: 50, width: 40, height: 40 };
      const res = calculateTooltipPosition(nearLeftTrigger, defaultTooltip, defaultViewport, { side: 'left' });

      assert.strictEqual(res.actualSide, 'right');
      assert.strictEqual(res.left, nearLeftTrigger.right + DEFAULT_SIDE_OFFSET);
    });
  });

  describe('3. Viewport Clamping (Never renders off-screen)', () => {
    it('clamps left coordinate to TOOLTIP_PADDING when overflowing left', () => {
      const trigger = { top: 200, bottom: 240, left: 5, right: 35, width: 30, height: 40 };
      const res = calculateTooltipPosition(trigger, { width: 150, height: 30 }, defaultViewport, { side: 'top' });

      assert.ok(res.left >= TOOLTIP_PADDING, `Expected left >= ${TOOLTIP_PADDING}, got ${res.left}`);
    });

    it('clamps right coordinate when overflowing right edge', () => {
      const trigger = { top: 200, bottom: 240, left: 1170, right: 1195, width: 25, height: 40 };
      const tWidth = 150;
      const res = calculateTooltipPosition(trigger, { width: tWidth, height: 30 }, defaultViewport, { side: 'top' });

      assert.ok(res.left + tWidth <= defaultViewport.width - TOOLTIP_PADDING, 'Must not overflow right edge');
    });

    it('supports custom sideOffset and align', () => {
      const trigger = { top: 200, bottom: 240, left: 500, right: 550, width: 50, height: 40 };
      const resStart = calculateTooltipPosition(trigger, defaultTooltip, defaultViewport, { side: 'bottom', align: 'start', sideOffset: 12 });

      assert.strictEqual(resStart.top, 240 + 12);
      assert.strictEqual(resStart.left, 500); // align: start matches trigger.left
    });
  });
});
