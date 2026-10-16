import { Player } from "./modules/player.js";
import { AI } from "./modules/ai.js";
import { UTILS } from "./libs/utils.js";
import { config } from "./config.js";
import { ProjectileManager } from "./modules/projectileManager.js";
import { Projectile } from "./modules/projectile.js";
import { ObjectManager } from "./modules/objectManager.js";
import { GameObject } from "./modules/gameObject.js";
import { items } from "./modules/items.js";
import { AiManager } from "./modules/aiMaanager.js";
import { accessories, hats } from "./modules/store.js";
import { ClanManager } from "./modules/clanManager.js";

import NanoTimer from "nanotimer";
import { encode } from "msgpack-lite";

export class Game {

    // state
    players = [];
    ais = [];
    projectiles = [];
    game_objects = [];

    server = {
        broadcast: (type, ...data) => {
            try {
                const payload = encode([type, data]);
                for (let i = 0; i < this.players.length; i++) {
                    const p = this.players[i];
                    if (!p || !p.socket) continue;
                    try { p.socket.send(payload); } catch (e) { /* ignore socket send errors */ }
                }
            } catch (e) {
                // encoding failed; skip broadcast
            }
        },
        send: (playerId, type, ...data) => {
            if (!playerId) return;
            for (let i = 0; i < this.players.length; i++) {
                const t = this.players[i];
                if (!t) continue;
                if (t.id === playerId) {
                    if (!t.socket) return;
                    try { t.socket.send(encode([type, data])); } catch (e) { /* ignore */ }
                    return;
                }
            }
        }
    };

    // managers
    ai_manager = null;
    object_manager = null;
    projectile_manager = null;
    clan_manager = null;

    id_storage = new Array(config.maxPlayersHard).fill(true);

    constructor() {

        this.object_manager = new ObjectManager(GameObject, this.game_objects, UTILS, config, this.players, this.server);
        this.ai_manager = new AiManager(this.ais, AI, this.players, items, this.object_manager, config, UTILS, (player, score) => {
            if (player && player.addResource) player.addResource(3, score); // 3 = points/gold
        }, this.server);
        this.projectile_manager = new ProjectileManager(Projectile, this.projectiles, this.players, this.ais, this.object_manager, items, config, UTILS, this.server);
        this.clan_manager = new ClanManager(this.players, this.server);
        this.aiSpawnPlan = this.buildAiSpawnPlan();
        this.aiSpawnCheckTimer = 0;

        const nano = (1000 / config.serverUpdateRate);
        const timer = new NanoTimer();

        let last = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
        let minimap_cd = config.minimapRate;

        // reuse arrays to reduce allocations (new temporary arrays only added)
        const minimap_ext = [];
        const tmpFlatPlayers = [];
        const tmpFlatObjects = [];
        const tmpAiPayload = [];
        const tmpCoords = [];
        const activeAisTmp = [];
        const leaderboardTmp = [];

        setInterval(() => {

            const t = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
            const delta = t - last;
            last = t;

            // leader tracking
            let kills = 0;
            let leader = null;

            const upd_map = minimap_cd <= 0;
            minimap_cd = upd_map ? config.minimapRate : minimap_cd - delta;

            // prepare minimap entries and call player updates
            minimap_ext.length = 0;
            for (let i = 0; i < this.players.length; i++) {
                const p = this.players[i];
                if (!p) continue;
                p.update(delta);
                p.iconIndex = 0;
                if (!p.alive) continue;
                if (p.kills > kills) {
                    kills = p.kills;
                    leader = p;
                }
                if (upd_map) minimap_ext.push({ sid: p.sid, x: p.x, y: p.y, team: p.team || null });
            }
            if (leader) leader.iconIndex = 1;

            // projectiles
            for (let i = 0; i < this.projectiles.length; i++) {
                const proj = this.projectiles[i];
                if (proj && proj.active && typeof proj.update === "function") proj.update(delta);
            }

            this.updateAnimals(delta);
            this.updateTurrets(delta);

            // leaderboard (keep small)
            leaderboardTmp.length = 0;
            {
                const metric = p => p.points;
                const maxEntries = Math.min(config.leaderboardMaxPlayers || 10, this.players.length);
                const top = [];
                for (let i = 0; i < this.players.length; i++) {
                    const p = this.players[i];
                    if (!p || !p.alive) continue;
                    const score = metric(p);
                    let j = 0;
                    while (j < top.length && top[j].points >= score) j++;
                    if (j < maxEntries) {
                        top.splice(j, 0, p);
                        if (top.length > maxEntries) top.pop();
                    } else if (top.length < maxEntries) {
                        top.push(p);
                    }
                }
                for (let i = 0; i < top.length; i++) {
                    const p = top[i];
                    leaderboardTmp.push(p.sid, p.name, p.points);
                }
            }
            this.server.broadcast("G", leaderboardTmp);

            // cache active AIs
            activeAisTmp.length = 0;
            for (let i = 0; i < this.ais.length; i++) {
                const ai = this.ais[i];
                if (ai && ai.active) activeAisTmp.push(ai);
            }

            // Main per-player send loop: build flat payloads and reuse arrays
            for (let pi = 0; pi < this.players.length; pi++) {
                const player = this.players[pi];
                if (!player || !player.active || !player.socket) continue;

                // reset flat buffers
                tmpFlatPlayers.length = 0;
                tmpFlatObjects.length = 0;

                // players visible to `player`
                for (let i2 = 0; i2 < this.players.length; i2++) {
                    const p2 = this.players[i2];
                    if (!p2 || !p2.alive) continue;
                    if (!player.canSee(p2)) continue;

                    if (!p2.sentTo[player.id]) {
                        p2.sentTo[player.id] = true;
                        try { this.server.send(player.id, "D", p2.getData()); } catch (e) { /* ignore */ }
                    }
                    if (player.id === p2.id && p2.needsResourceSync) {
                        p2.needsResourceSync = false;
                        p2.syncResources();
                    }
                    const info = p2.getInfo();
                    for (let k = 0; k < info.length; k++) tmpFlatPlayers.push(info[k]);
                }

                // objects visible to `player`
                for (let oi = 0; oi < this.game_objects.length; oi++) {
                    const obj = this.game_objects[oi];
                    if (!obj || !obj.active) continue;
                    if (obj.sentTo && obj.sentTo[player.id]) continue;
                    if (!obj.visibleToPlayer(player) || !player.canSee(obj)) continue;
                    tmpFlatObjects.push(
                        obj.sid,
                        UTILS.fixTo(obj.x, 1),
                        UTILS.fixTo(obj.y, 1),
                        obj.dir,
                        obj.scale,
                        obj.type,
                        obj.id,
                        obj.owner ? obj.owner.sid : -1
                    );
                    if (!obj.sentTo) obj.sentTo = {};
                    obj.sentTo[player.id] = true;
                }

                // send players / objects
                try { player.send("a", tmpFlatPlayers.length > 0 ? tmpFlatPlayers : null); } catch (e) {}
                try { player.send("H", tmpFlatObjects.length > 0 ? tmpFlatObjects : null); } catch (e) {}

                // build & send ai payload
                tmpAiPayload.length = 0;
                for (let aiI = 0; aiI < activeAisTmp.length; aiI++) {
                    const ai = activeAisTmp[aiI];
                    if (!ai || !ai.alive) continue;
                    if (!player.canSee(ai)) continue;
                    tmpAiPayload.push(
                        ai.sid,
                        ai.index,
                        UTILS.fixTo(ai.x, 1),
                        UTILS.fixTo(ai.y, 1),
                        UTILS.fixTo(ai.dir, 3),
                        Math.round(ai.health),
                        ai.nameIndex ?? 0
                    );
                }
                try { player.send("I", tmpAiPayload.length > 0 ? tmpAiPayload : null); } catch (e) {}

                // minimap coords
                if (minimap_ext.length) {
                    tmpCoords.length = 0;
                    for (let mi = 0; mi < minimap_ext.length; mi++) {
                        const t = minimap_ext[mi];
                        if (t.sid === player.sid) continue;
                        if (!config.isSandbox && player.team && t.team !== player.team) continue;
                        tmpCoords.push(t.x, t.y);
                    }
                    if (tmpCoords.length) {
                        try { player.send("7", tmpCoords); } catch (e) {}
                    }
                }
            }

        }, nano);
    }

    buildAiSpawnPlan() {
        const map = config.mapScale;
        const fallbackPlan = [{
            index: 0, desired: 12
        }, {
            index: 1, desired: 10
        }, {
            index: 4, desired: 8
        }, {
            index: 5, desired: 6
        }, {
            index: 2, desired: 8
        }, {
            index: 3, desired: 6
        }, {
            index: 6, desired: 1, positions: [{ xRatio: 0.42, yRatio: 0.72 }]
        }, {
            index: 7, desired: 1, positions: [{ xRatio: 0.18, yRatio: 0.22 }]
        }, {
            index: 8, desired: 1, positions: [{ xRatio: 0.78, yRatio: 0.64 }]
        }];

        const planSource = Array.isArray(config.animalSpawnPlan) && config.animalSpawnPlan.length ? config.animalSpawnPlan : fallbackPlan;

        return planSource.map(plan => {
            if (!Number.isInteger(plan.index)) return null;
            const desired = typeof plan.desired === "number" ? plan.desired : 0;
            if (desired <= 0) return null;
            const rawPositions = Array.isArray(plan.positions) ? plan.positions : [];
            const resolvedPositions = rawPositions.map(pos => {
                if (typeof pos.x === "number" && typeof pos.y === "number") return { x: pos.x, y: pos.y };
                if (typeof pos.xRatio === "number" && typeof pos.yRatio === "number") {
                    const xRatio = Math.min(Math.max(pos.xRatio, 0), 1);
                    const yRatio = Math.min(Math.max(pos.yRatio, 0), 1);
                    return { x: Math.round(map * xRatio), y: Math.round(map * yRatio) };
                }
                return null;
            }).filter(Boolean);
            return { index: plan.index, desired, positions: resolvedPositions.length ? resolvedPositions : undefined, nextPosition: 0 };
        }).filter(Boolean);
    }

    ensureAnimals() {
        if (!this.ai_manager || !this.aiSpawnPlan) return;
        for (let pi = 0; pi < this.aiSpawnPlan.length; pi++) {
            const plan = this.aiSpawnPlan[pi];
            let activeOfType = 0;
            for (let i = 0; i < this.ais.length; i++) {
                const a = this.ais[i];
                if (a && a.active && a.index === plan.index) activeOfType++;
            }
            let safety = 0;
            while (activeOfType < plan.desired && safety < plan.desired * 3) {
                const spawnPos = this.nextAnimalPosition(plan);
                if (!spawnPos) break;
                const dir = UTILS.randFloat(-Math.PI, Math.PI);
                this.ai_manager.spawn(spawnPos.x, spawnPos.y, dir, plan.index);
                activeOfType++;
                safety++;
            }
        }
    }

    nextAnimalPosition(plan) {
        const type = this.ai_manager.aiTypes[plan.index];
        if (!type) return null;
        if (plan.positions && plan.positions.length) {
            const pos = plan.positions[plan.nextPosition % plan.positions.length];
            plan.nextPosition = (plan.nextPosition + 1) % plan.positions.length;
            if (this.validateAnimalSpawn(plan.index, pos.x, pos.y)) return { x: pos.x, y: pos.y };
        }
        return this.randomAnimalPosition(plan.index);
    }

    validateAnimalSpawn(index, x, y) {
        const type = this.ai_manager.aiTypes[index];
        if (!type) return false;
        const scale = type.scale;
        if (x < scale || y < scale || x > config.mapScale - scale || y > config.mapScale - scale) return false;
        if (!this.object_manager.checkItemLocation(x, y, scale, 0.6, null, false, null)) return false;
        for (let i = 0; i < this.ais.length; i++) {
            const a = this.ais[i];
            if (!a || !a.active) continue;
            if (UTILS.getDistance(x, y, a.x, a.y) < a.scale + scale) return false;
        }
        return true;
    }

    randomAnimalPosition(index) {
        const type = this.ai_manager.aiTypes[index];
        if (!type) return null;
        for (let attempt = 0; attempt < 40; attempt++) {
            const x = UTILS.randInt(type.scale, config.mapScale - type.scale);
            const y = UTILS.randInt(type.scale, config.mapScale - type.scale);
            if (this.validateAnimalSpawn(index, x, y)) return { x, y };
        }
        return { x: UTILS.randInt(type.scale, config.mapScale - type.scale), y: UTILS.randInt(type.scale, config.mapScale - type.scale) };
    }

    updateAnimals(delta) {
        for (let i = 0; i < this.ais.length; i++) {
            const a = this.ais[i];
            if (a && a.active) a.update(delta);
        }
        this.aiSpawnCheckTimer -= delta;
        if (this.aiSpawnCheckTimer <= 0) {
            this.aiSpawnCheckTimer = 1000;
            this.ensureAnimals();
        }
    }

    updateTurrets(delta) {
        if (!this.object_manager || !this.projectile_manager) return;
        const structures = this.object_manager.updateObjects;
        if (!structures || structures.length === 0) return;
        for (let i = 0; i < structures.length; i++) {
            const structure = structures[i];
            if (!structure || !structure.active) continue;
            if (typeof structure.update === "function") structure.update(delta);
            if (structure.projectile == null || !structure.shootRate || !structure.shootRange) continue;
            if (typeof structure.shootCount !== "number") structure.shootCount = structure.shootRate;
            structure.shootCount -= delta;
            if (structure.shootCount > 0) continue;

            const target = this.pickTurretTarget(structure);
            if (!target) {
                structure.shootCount = Math.min(structure.shootRate, 250);
                continue;
            }

            const direction = UTILS.getDirection(target.x, target.y, structure.x, structure.y);
            structure.dir = direction;

            const projectileData = items.projectiles[structure.projectile];
            if (!projectileData) {
                structure.shootCount = structure.shootRate;
                continue;
            }
            const projectileSpeed = projectileData.speed || 1.6;
            const muzzleOffset = structure.scale + 45;
            const spawnX = structure.x + Math.cos(direction) * muzzleOffset;
            const spawnY = structure.y + Math.sin(direction) * muzzleOffset;

            this.projectile_manager.addProjectile(spawnX, spawnY, direction, structure.shootRange, projectileSpeed, structure.projectile, structure.owner, structure.sid, projectileData.layer);
            structure.shootCount = structure.shootRate;
            this.broadcastTurretShot(structure, direction);
        }
    }

    pickTurretTarget(structure) {
        let bestTarget = null;
        let bestDist = Infinity;
        const owner = structure.owner;
        const ownerTeam = owner && owner.team ? owner.team : null;

        const consider = (candidate) => {
            const distance = UTILS.getDistance(structure.x, structure.y, candidate.x, candidate.y);
            if (distance > structure.shootRange + (candidate.scale || 0)) return;
            if (!bestTarget || distance < bestDist) {
                bestTarget = candidate;
                bestDist = distance;
            }
        };

        for (let i = 0; i < this.players.length; i++) {
            const p = this.players[i];
            if (!p || !p.active || !p.alive) continue;
            if (p === owner) continue;
            if (p.skinIndex === 22) continue;
            if (ownerTeam && p.team && p.team === ownerTeam) continue;
            if (p.skin && p.skin.invisTimer && p.noMovTimer >= p.skin.invisTimer) continue;
            consider(p);
        }

        for (let i = 0; i < this.ais.length; i++) {
            const a = this.ais[i];
            if (!a || !a.active || !a.alive) continue;
            consider(a);
        }

        return bestTarget;
    }

    broadcastTurretShot(structure, direction) {
        const fixedDir = UTILS.fixTo(direction, 2);
        for (let i = 0; i < this.players.length; i++) {
            const p = this.players[i];
            if (!p || !p.active) continue;
            if (!structure.sentTo[p.id]) continue;
            if (!p.canSee(structure)) continue;
            try { p.send("M", structure.sid, fixedDir); } catch (e) {}
        }
    }

    addPlayer(socket) {

        const string_id = UTILS.randomString(16);
        const sid = this.id_storage.findIndex(b => b);
        const player = new Player(
            string_id,
            sid,
            config,
            UTILS,
            this.projectile_manager,
            this.object_manager,
            this.players,
            this.ais,
            items,
            hats,
            accessories,
            socket,
            (player, score) => {
                if (player && player.addResource) player.addResource(3, score); // 3 = points/gold
            },
            () => {}
        );

        player.send("io-init", player.id);
        player.send("A", { teams: this.clan_manager.ext() });

        this.id_storage[sid] = false;
        this.players.push(player);

        return player;

    }

    removePlayer(id) {

        for (let i = 0; i < this.players.length; i++) {

            const player = this.players[i];

            if (player.id === id) {
                this.server.broadcast("E", player.id);
                this.object_manager.removeAllItems(player.sid, this.server);
                this.players.splice(i, 1);
                this.id_storage[player.sid] = true;
                break;
            }

        }

    }

}
