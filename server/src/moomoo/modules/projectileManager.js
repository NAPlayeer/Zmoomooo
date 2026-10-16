export class ProjectileManager {
    constructor(Projectile, projectiles, players, ais, objectManager, items, config, UTILS, server) {
        this.addProjectile = function(x, y, dir, range, speed, indx, owner, ignoreObj, layer) {
            // validate inputs
            if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(dir)) return null;
            if (!Number.isFinite(range)) range = 1000;
            if (!Number.isFinite(speed)) speed = 1.6;
            if (typeof indx !== "number") return null;
            if (!items || !items.projectiles || !items.projectiles[indx]) return null;

            var tmpData = items.projectiles[indx];
            var tmpProj = null;

            for (var i = 0; i < projectiles.length; ++i) {
                if (!projectiles[i].active) {
                    tmpProj = projectiles[i];
                    break;
                }
            }

            if (!tmpProj) {
                tmpProj = new Projectile(players, ais, objectManager, items, config, UTILS, server);
                tmpProj.sid = projectiles.length;
                projectiles.push(tmpProj);
            }

            try {
                tmpProj.init(indx, x, y, dir, speed, (tmpData.dmg || 0), range, (tmpData.scale || 1), owner);
            } catch (e) {
                // init failed, disable and return null
                tmpProj.active = false;
                return null;
            }

            tmpProj.ignoreObj = (typeof ignoreObj !== "undefined") ? ignoreObj : null;
            tmpProj.layer = (typeof layer !== "undefined") ? layer : (tmpData.layer || 0);
            tmpProj.src = tmpData.src || null;
            tmpProj.active = true;

            return tmpProj;
        };
    };
}
