import { acquirePageSurfaces, releasePageSurfaces } from './page-surfaces.js';
import { applyAirBurstImpulse } from './snow-physics.js';

const EMOJI = /[\p{Extended_Pictographic}\p{Regional_Indicator}\u20e3]/u;
const MIN_IMPACT_SPEED = 100;
const DISLODGING_ENERGY = 160 ** 2;

export class ParticleEnvironment {
  constructor(config, onComplete) {
    this.config = config;
    this.onComplete = onComplete;
    this.initialized = new WeakSet();
    this.settled = new Map();
    this.particles = [];
    this.time = 0;
    this.completed = false;
    this.surfaces = null;
    this.pointer = null;
    this.restingContacts = new WeakMap();
    this.setEnabled(config.accumulationEnabled !== false);
  }

  setEnabled(enabled) {
    this.config.accumulationEnabled = enabled;
    if (enabled && !this.surfaces) this.surfaces = acquirePageSurfaces();
    if (!enabled && this.surfaces) {
      this.clear();
      releasePageSurfaces(this.surfaces);
      this.surfaces = null;
    }
  }

  beginFrame(delta, particles, width, height, wind = null) {
    this.particles = particles;
    this.time += delta;
    this.delta = delta;
    this.wind = wind;
    const now = performance.now();
    this.surfaces?.refresh(now);
    this.surfaces?.syncPlacements();
    for (const [flake, placement] of this.settled) {
      const decay = Math.exp(-delta);
      const exposure = Math.sqrt(20 / flake.size);
      const force = wind?.windEnabled ? wind.currentWindForce || 0 : 0;
      const lift = wind?.windEnabled ? wind.currentWindLift || 0 : 0;
      const vortex = wind?.windEnabled ? wind.currentWindVortex || 0 : 0;
      const gustX = (force * 40 + Math.sin(this.time + flake.x * 0.01) * vortex * 25) * exposure;
      const gustY = -lift * 70 * exposure;
      placement.windX = (placement.windX || 0) * decay + gustX * (1 - decay);
      placement.windY = (placement.windY || 0) * decay + gustY * (1 - decay);
      if (Math.hypot(placement.windX, placement.windY) >= MIN_IMPACT_SPEED) {
        this.release(flake);
        flake.velocityX = placement.windX;
        flake.velocityY = placement.windY;
        continue;
      }
      if (this.time >= placement.nextCheck) {
        placement.nextCheck = this.time + 0.75;
        const ignored = new Set([flake, ...placement.supports]);
        for (const [other, otherPlacement] of this.surfaces.placements) {
          if (otherPlacement.supports.includes(flake)) ignored.add(other);
        }
        if (!this.surfaces.hasRoom(placement, flake.x, flake.size, ignored, flake.y)) this.release(flake);
      }
    }
    if (this.surfaces && now - this.surfaces.lastScroll >= 350) {
      for (const flake of particles) {
        if (!flake.isFinished && !flake.isAwaitingRespawn && !flake.isSettled && !flake.isGrabbed
          && !flake.hasShed) this.settleRestingContact(flake);
      }
    }
    for (const flake of particles) {
      if (!this.initialized.has(flake)) {
        this.initialized.add(flake);
        const origin = this.config.burstOrigin;
        if (origin) {
          flake.x = flake.baseX = Math.min(width, Math.max(0, origin.x));
          flake.y = Math.min(height, Math.max(0, origin.y));
          const angle = Math.random() * Math.PI * 2;
          const impulse = 120 + Math.random() * 240;
          flake.velocityX = Math.cos(angle) * impulse;
          flake.velocityY = Math.sin(angle) * impulse;
          flake.isAwaitingRespawn = false;
        }
      }
      flake.previousSurfaceY = flake.y;
      flake.previousSurfaceX = flake.x;
      const velocity = this.impactVelocity(flake);
      flake.previousImpactVelocity = velocity.y;
      flake.previousImpactVelocityX = velocity.x;
      if (this.config.finiteParticles && this.time > 2 && !flake.isSettled && !flake.isGrabbed) {
        const minimum = Math.max(20, (flake.fallSpeed || 0) * 0.35);
        flake.velocityY = (flake.velocityY || 0) + Math.max(0, minimum - velocity.y);
      }
    }
  }

  retire(flake) {
    if (!this.config.finiteParticles) {
      flake.hasShed = false;
      return false;
    }
    flake.isFinished = true;
    flake.isAwaitingRespawn = true;
    flake.velocityX = flake.velocityY = 0;
    return true;
  }

  resetMotion(flake) {
    flake.previousSurfaceX = flake.x;
    flake.previousSurfaceY = flake.y;
    this.restingContacts.delete(flake);
  }

  updatePointer(x, y, velocityX, velocityY, radius) {
    if (Math.hypot(velocityX, velocityY) > 0.001) {
      this.dislodgeAt(x, y, radius, this.pointer);
    }
    this.pointer = { x, y };
  }

  applyAirBurst(x, y, radius, mode, strength, duration = 0.2) {
    if (!Number.isFinite(x) || !Number.isFinite(y)
      || !Number.isFinite(radius) || radius <= 0
      || !Number.isFinite(strength) || strength <= 0
      || !Number.isFinite(duration) || duration < 0
      || (mode !== 'blower' && mode !== 'explode' && mode !== 'suction')) return 0;
    let affected = 0;
    for (const flake of [...this.settled.keys()]) {
      if (!this.settled.has(flake) || Math.hypot(flake.x - x, flake.y - y) >= radius) continue;
      this.release(flake);
      applyAirBurstImpulse(flake, x, y, radius, mode, strength, duration);
      affected++;
    }
    return affected;
  }

  dislodgeAt(x, y, radius, previous = null) {
    if (radius <= 0) return;
    const startX = previous?.x ?? x;
    const startY = previous?.y ?? y;
    const dx = x - startX;
    const dy = y - startY;
    const lengthSq = dx * dx + dy * dy;
    for (const flake of this.settled.keys()) {
      const projection = lengthSq > 0
        ? Math.max(0, Math.min(1, ((flake.x - startX) * dx + (flake.y - startY) * dy) / lengthSq))
        : 0;
      const distance = Math.hypot(flake.x - startX - projection * dx, flake.y - startY - projection * dy);
      if (distance < radius + flake.size / 2) this.release(flake);
    }
  }

  impactVelocity(flake) {
    return {
      x: flake.velocityX || 0,
      y: (flake.fallSpeed || 0) + (flake.velocityY || 0)
    };
  }

  canDislodge(flake, other) {
    const dx = other.x - (flake.previousSurfaceX ?? flake.x);
    const dy = other.y - (flake.previousSurfaceY ?? flake.y);
    const distance = Math.hypot(dx, dy);
    const nx = distance > 0 ? dx / distance : 0;
    const ny = distance > 0 ? dy / distance : 1;
    const velocity = this.impactVelocity(flake);
    const speed = Math.max(0, velocity.x * nx + velocity.y * ny);
    const previousSpeed = (flake.previousImpactVelocityX || 0) * nx + flake.previousImpactVelocity * ny;
    const acceleration = this.delta > 0
      ? Math.max(0, (speed - previousSpeed) / this.delta) : 0;
    const massRatio = (flake.size / other.size) ** 2;
    return speed >= MIN_IMPACT_SPEED
      && massRatio * (speed ** 2 + 2 * acceleration * flake.size) >= DISLODGING_ENERGY;
  }

  findLanding(surface, flake) {
    const tracker = this.surfaces;
    const radius = flake.size / 2;
    const candidates = [flake.x];
    for (const [other] of tracker.placements) {
      candidates.push(other.x - (other.size + flake.size) / 2 - 3,
        other.x + (other.size + flake.size) / 2 + 3);
    }
    candidates.sort((a, b) => Math.abs(a - flake.x) - Math.abs(b - flake.x));
    for (const x of candidates) {
      if (Math.abs(x - flake.x) > flake.size * 3
        || x - radius < Math.max(0, surface.left)
        || x + radius > Math.min(window.innerWidth, surface.right)) continue;
      if (tracker.hasRoom(surface, x, flake.size)) return { x };
    }
    return null;
  }

  contactWithSurface(flake, startX, startY) {
    const descent = flake.y - startY;
    if (descent <= 0) return null;
    const radius = flake.size / 2;
    const contacts = [];
    for (const surface of this.surfaces.surfaces) {
      const y = surface.top - radius - 2;
      const t = (y - startY) / descent;
      if (t < 0 || t > 1) continue;
      const x = startX + (flake.x - startX) * t;
      if (x - radius < Math.max(0, surface.left)
        || x + radius > Math.min(window.innerWidth, surface.right)) continue;
      contacts.push({ surface, x, y, t });
    }
    contacts.sort((a, b) => a.t - b.t);
    for (const contact of contacts) {
      const room = this.surfaces.hasRoom(contact.surface, contact.x, flake.size);
      if (room || this.surfaces.hasRoom(
        contact.surface, contact.x, flake.size, new Set(this.surfaces.placements.keys())
      )) return { ...contact, room };
    }
    return null;
  }

  contactWithSettled(flake, startX = flake.previousSurfaceX ?? flake.x,
    startY = flake.previousSurfaceY ?? flake.y) {
    let first = null;
    const dx = flake.x - startX;
    const dy = flake.y - startY;
    const lengthSq = dx * dx + dy * dy;
    for (const [other, placement] of this.surfaces.placements) {
      const radius = (flake.size + other.size) / 2 + 2;
      const ox = startX - other.x;
      const oy = startY - other.y;
      const c = ox * ox + oy * oy - radius * radius;
      const b = ox * dx + oy * dy;
      if (c >= -0.001 && b >= 0
        && (Math.abs(c) > 0.05 || lengthSq > (this.delta * 4) ** 2)) continue;
      const discriminant = b * b - lengthSq * c;
      if (c > 0 && (lengthSq === 0 || discriminant < 0)) continue;
      const t = c <= 0 ? 0 : (-b - Math.sqrt(discriminant)) / lengthSq;
      if (t < 0 || t > 1 || (first && t >= first.t)) continue;
      first = { other, placement, t, x: startX + dx * t, y: startY + dy * t };
    }
    return first;
  }

  isRestingOn(flake, support, x, y, supports = [support]) {
    const previous = this.restingContacts.get(flake);
    const surface = this.surfaces?.placements.get(support);
    const offsetX = x - (surface?.left ?? support.x);
    const offsetY = y - (surface?.top ?? support.y);
    // At rest between neighbours, the earliest contact can alternate between supports.
    const pocket = supports.length > 1;
    const samePocket = pocket && previous?.supports?.length === supports.length
      && supports.every((other) => previous.supports.includes(other));
    const sameSupport = samePocket || previous?.support === support
      || (surface && previous?.element === surface.element);
    const stable = sameSupport
      && Math.abs(previous.frameTime - (this.time - this.delta)) < 0.000001
      && Math.hypot(offsetX - previous.x, offsetY - previous.y) <= (samePocket ? 1.5 : 0.4);
    const duration = stable ? previous.duration + this.delta : 0;
    this.restingContacts.set(flake, {
      support, supports, element: surface?.element,
      x: stable ? previous.x : offsetX, y: stable ? previous.y : offsetY,
      duration, frameTime: this.time
    });
    return duration >= 0.3;
  }

  settleRestingContact(flake) {
    const contacts = [];
    for (const [other, placement] of this.surfaces.placements) {
      const distance = Math.hypot(flake.x - other.x, flake.y - other.y);
      const gap = distance - (flake.size + other.size) / 2 - 2;
      if (distance === 0 || (flake.y - other.y) / distance >= -0.05
        || gap < -0.5 || gap > 1) continue;
      contacts.push({ other, placement, gap });
    }
    const pocket = contacts.some(({ other }) => other.x < flake.x)
      && contacts.some(({ other }) => other.x > flake.x);
    const supports = contacts.filter(({ gap }) => pocket || gap <= 0.5).map(({ other }) => other);
    if (!supports.length) {
      this.restingContacts.delete(flake);
      return false;
    }
    const previous = this.restingContacts.get(flake)?.support;
    const support = supports.includes(previous) ? previous : supports[0];
    const surface = this.surfaces.placements.get(support);
    if (!this.isRestingOn(flake, support, flake.x, flake.y, pocket ? supports : [support])) return false;
    if (this.canAccumulate(flake)
      && this.surfaces.hasRoom(surface, flake.x, flake.size, new Set(supports), flake.y)
      && this.settle(flake, surface, flake.y, support, supports)) return true;
    this.release(flake);
    return false;
  }

  canAccumulate(flake) {
    const glyph = flake.char ?? flake.glyph ?? this.config.snowletters?.[flake.glyphIndex];
    return !flake.hasShed && !flake.isSentence && flake.size <= 48 && flake.size >= 4
      && EMOJI.test(glyph || '');
  }

  settle(flake, surface, y, support = null, supports = support ? [support] : []) {
    const tracker = this.surfaces;
    if (tracker.placements.size >= 32 || y - flake.size / 2 < 0) return false;
    // A landing must not insert a stationary particle into another moving particle.
    if (this.particles.some((other) => other !== flake && !other.isFinished && !other.isSettled
      && !other.isAwaitingRespawn
      && Math.hypot(other.x - flake.x, other.y - y) < (other.size + flake.size) / 2)) return false;
    const placement = {
      ...surface, support, supports, environment: this,
      nextCheck: this.time + 0.75, revision: tracker.revision
    };
    flake.y = y;
    flake.baseX = flake.x;
    flake.velocityX = flake.velocityY = flake.velocityZ = 0;
    flake.rotationSpeed = 0;
    const sinPhase = this.wind?.instances
      ? Math.sin(flake.phase || 0) : (flake._sinPhase ?? Math.sin(flake.phase || 0));
    const swing = this.wind?.lowQualityMode ? 0 : sinPhase * 0.35 * (flake.swayLimit ?? 1);
    flake.rotation = flake.cumulativeSpin = (flake.cumulativeSpin || 0) + swing;
    flake.swayLimit = 0;
    flake.phase = flake._sinPhase = 0;
    flake.rotationSpeedX = flake.rotationSpeedY = flake.rotationSpeedZ = 0;
    flake.isSettled = true;
    this.restingContacts.delete(flake);
    this.settled.set(flake, placement);
    tracker.placements.set(flake, placement);
    this.contactsChanged = true;
    return true;
  }

  finishFrame() {
    this.contactsChanged = false;
    const tracker = this.surfaces;
    if (tracker && performance.now() - tracker.lastScroll >= 350) {
      for (const flake of this.particles) {
        if (flake.isFinished || flake.isAwaitingRespawn || flake.isSettled || flake.isGrabbed) continue;
        const canSettle = this.canAccumulate(flake);
        let startX = flake.previousSurfaceX ?? flake.x;
        let startY = flake.previousSurfaceY ?? flake.y;
        let remaining = this.delta;
        for (let iteration = 0; !flake.hasShed && iteration < 6; iteration++) {
          // A neighbouring support can redirect motion back into an earlier contact.
          const contact = this.contactWithSettled(flake, startX, startY);
          const surfaceContact = canSettle ? this.contactWithSurface(flake, startX, startY) : null;
          if (surfaceContact && (!contact || surfaceContact.t < contact.t)) {
            const { surface, x, y, room } = surfaceContact;
            flake.x = flake.baseX = x;
            if (room && this.settle(flake, surface, y)) break;
            flake.y = y;
            this.contactsChanged = true;
            flake.velocityY = -(flake.fallSpeed || 0);
            const free = this.findLanding(surface, flake);
            if (free) flake.velocityX += Math.sign(free.x - flake.x) * 24 * this.delta;
            break;
          }
          if (!contact) break;
          this.contactsChanged = true;
          const { other, placement, x, y } = contact;
          if (this.canDislodge(flake, other)) {
            const velocity = this.impactVelocity(flake);
            placement.environment.release(other);
            other.velocityX = velocity.x * 0.2;
            other.velocityY = Math.max(20, velocity.y * 0.25);
          } else {
            const distance = Math.hypot(x - other.x, y - other.y);
            const nx = distance > 0 ? (x - other.x) / distance : 0;
            const ny = distance > 0 ? (y - other.y) / distance : -1;
            const separation = (flake.size + other.size) / 2 + 2;
            flake.x = flake.baseX = other.x + nx * separation;
            flake.y = other.y + ny * separation;
            if (flake.y - flake.size / 2 < 0) {
              this.release(flake);
              break;
            }
            const stackImmediately = ny < -0.95 && !this.findLanding(placement, flake);
            const landingY = flake.y;
            if (canSettle && !placement.support && stackImmediately
              && tracker.hasRoom(placement, flake.x, flake.size, new Set([other]), landingY)
              && this.settle(flake, placement, landingY, other)) break;
            const velocity = this.impactVelocity(flake);
            const normalSpeed = velocity.x * nx + velocity.y * ny;
            if (normalSpeed < 0) {
              const restitution = ny >= -0.7 || normalSpeed < -60 ? 0.15 : 0;
              flake.velocityX = (flake.velocityX || 0) - (1 + restitution) * normalSpeed * nx;
              flake.velocityY = (flake.velocityY || 0) - (1 + restitution) * normalSpeed * ny;
            }
            // A centred weak impact rolls off; it is never moved to a distant free slot.
            if (Math.abs(nx) < 0.1 && Math.abs(flake.velocityX || 0) < 24) {
              const free = this.findLanding(placement, flake);
              const direction = free ? Math.sign(free.x - flake.x) : (flake.velocityX >= 0 ? 1 : -1);
              flake.velocityX += direction * 45 * this.delta;
            }
            remaining *= 1 - contact.t;
            startX = flake.x;
            startY = flake.y;
            const outgoing = this.impactVelocity(flake);
            if (iteration === 5) break;
            flake.x += outgoing.x * remaining;
            flake.baseX = flake.x;
            flake.y += outgoing.y * remaining;
          }
        }
      }
    }
    if (this.config.finiteParticles && this.particles.length && !this.completed
      && this.particles.every((flake) => flake.isFinished)) {
      this.completed = true;
      queueMicrotask(() => this.onComplete?.());
    }
  }

  release(flake) {
    this.restingContacts.delete(flake);
    flake.isSettled = false;
    flake.swayLimit = 1;
    flake.hasShed = true;
    flake.velocityY = Math.max(80, flake.fallSpeed || 0);
    flake.velocityX = (Math.random() - 0.5) * 90;
    flake.baseX = flake.x;
    this.settled.delete(flake);
    this.surfaces?.placements.delete(flake);
    if (this.surfaces) {
      for (const [other, placement] of this.surfaces.placements) {
        if (placement.supports.includes(flake)) placement.environment.release(other);
      }
    }
  }

  clear() {
    for (const flake of this.settled.keys()) this.release(flake);
  }

  destroy() {
    this.clear();
    if (this.surfaces) releasePageSurfaces(this.surfaces);
    this.surfaces = null;
    this.particles = [];
  }
}
