var mathFloor = Math.floor;
var mathABS = Math.abs;
var mathCOS = Math.cos;
var mathSIN = Math.sin;
var mathPOW = Math.pow;
var mathSQRT = Math.sqrt;

export class ObjectManager {
    constructor(GameObject, gameObjects, UTILS, config, players, server) {
        this.objects = gameObjects;
        this.grids = {};
        this.updateObjects = [];
        var cactusDamage = typeof config.cactusDamage === "number" ? config.cactusDamage : 20;
        var desertStart = typeof config.mapScale === "number" && typeof config.snowBiomeTop === "number" ? config.mapScale - config.snowBiomeTop : null;
	// set objects grid
        var tmpX;
        var tmpY;
        var tmpS = config.mapScale / config.colGrid;

        this.setObjectGrids = function(obj) {
            if (!obj || !obj.x || !obj.y || !obj.scale) return;
            var objX = Math.min(config.mapScale, Math.max(0, obj.x));
            var objY = Math.min(config.mapScale, Math.max(0, obj.y));
            obj.gridLocations = obj.gridLocations || [];

            for (var x = 0; x < config.colGrid; ++x) {
                tmpX = x * tmpS;
                for (var y = 0; y < config.colGrid; ++y) {
                    tmpY = y * tmpS;
                    if (objX + obj.scale >= tmpX && objX - obj.scale <= tmpX + tmpS && objY + obj.scale >= tmpY && objY - obj.scale <= tmpY + tmpS) {
                        var key = x + "_" + y;
                        if (!this.grids[key]) this.grids[key] = [];
                        if (this.grids[key].indexOf(obj) === -1) this.grids[key].push(obj);
                        if (obj.gridLocations.indexOf(key) === -1) obj.gridLocations.push(key);
                    }
                }
            }
        };
	// Remove objects from the grid
        this.removeObjGrid = function(obj) {
            if (!obj || !Array.isArray(obj.gridLocations)) return;
            for (var i = 0; i < obj.gridLocations.length; ++i) {
                var key = obj.gridLocations[i];
                if (!this.grids[key]) continue;
                var idx = this.grids[key].indexOf(obj);
                if (idx >= 0) this.grids[key].splice(idx, 1);
                if (this.grids[key].length === 0) delete this.grids[key];
            }
            obj.gridLocations.length = 0;
        };
	// disable objects
        this.disableObj = function(obj) {
            if (!obj) return;
            obj.active = false;

            if (obj.owner && obj.pps) {
                obj.owner.pps -= obj.pps;
            }
		// removes object from grid
            this.removeObjGrid(obj);

            var tmpIndx = this.updateObjects.indexOf(obj);
            if (tmpIndx >= 0) this.updateObjects.splice(tmpIndx, 1);
        };
	// hit objects
        this.hitObj = function(tmpObj, tmpDir) {
            for (var p = 0; p < players.length; ++p) {
                if (players[p].active) {
                    if (tmpObj.sentTo[players[p].id]) {
                        if (!tmpObj.active) {
                            players[p].send("Q", tmpObj.sid);
                        } else {
                            if (players[p].canSee(tmpObj)) {
                                players[p].send("L", UTILS.fixTo(tmpDir, 1), tmpObj.sid);
                            }
                        }
                    }
                    if (!tmpObj.active && tmpObj.owner == players[p]) {
                        players[p].changeItemCount(tmpObj.group.id, -1);
                    }
                }
            }
        };
	// get grid array
        var tmpArray = [];
        var tmpGrid;

        this.getGridArrays = function(xPos, yPos, s) {
            tmpX = mathFloor(xPos / tmpS);
            tmpY = mathFloor(yPos / tmpS);
            tmpArray.length = 0;

            try {
                if (this.grids[tmpX + "_" + tmpY]) tmpArray.push(this.grids[tmpX + "_" + tmpY]);

                if (xPos + s >= (tmpX + 1) * tmpS) {
			// right
                    tmpGrid = this.grids[tmpX + 1 + "_" + tmpY];
                    if (tmpGrid && tmpArray.indexOf(tmpGrid) === -1) tmpArray.push(tmpGrid);
                    if (tmpY && yPos - s <= tmpY * tmpS) {
			// top right
                        tmpGrid = this.grids[tmpX + 1 + "_" + (tmpY - 1)];
                        if (tmpGrid && tmpArray.indexOf(tmpGrid) === -1) tmpArray.push(tmpGrid);
                    } else {
                        if (yPos + s >= (tmpY + 1) * tmpS) {
				// bottom right
                            tmpGrid = this.grids[tmpX + 1 + "_" + (tmpY + 1)];
                            if (tmpGrid && tmpArray.indexOf(tmpGrid) === -1) tmpArray.push(tmpGrid);
                        }
                    }
                }

                if (tmpX && xPos - s <= tmpX * tmpS) {
			// left
                    tmpGrid = this.grids[tmpX - 1 + "_" + tmpY];
                    if (tmpGrid && tmpArray.indexOf(tmpGrid) === -1) tmpArray.push(tmpGrid);
                    if (tmpY && yPos - s <= tmpY * tmpS) {
			// top left
                        tmpGrid = this.grids[tmpX - 1 + "_" + (tmpY - 1)];
                        if (tmpGrid && tmpArray.indexOf(tmpGrid) === -1) tmpArray.push(tmpGrid);
                    } else { 	
                        if (yPos + s >= (tmpY + 1) * tmpS) { 
				// bottom left
                            tmpGrid = this.grids[tmpX - 1 + "_" + (tmpY + 1)];
                            if (tmpGrid && tmpArray.indexOf(tmpGrid) === -1) tmpArray.push(tmpGrid);
                        }
                    }
                }
		// bottom
                if (yPos + s >= (tmpY + 1) * tmpS) {
                    tmpGrid = this.grids[tmpX + "_" + (tmpY + 1)];
                    if (tmpGrid && tmpArray.indexOf(tmpGrid) === -1) tmpArray.push(tmpGrid);
                }
		// top
                if (tmpY && yPos - s <= tmpY * tmpS) {
                    tmpGrid = this.grids[tmpX + "_" + (tmpY - 1)];
                    if (tmpGrid && tmpArray.indexOf(tmpGrid) === -1) tmpArray.push(tmpGrid);
                }
            } catch (e) {
            }

            return tmpArray;
        };

        var tmpObj;

        this.add = function(sid, x, y, dir, s, type, data, setSID, owner) {
            if (!data && type === 1 && desertStart !== null && y >= desertStart) {
                data = {
                    name: "cactus",
                    dmg: cactusDamage
                };
            }

            tmpObj = null;

            for (var i = 0; i < gameObjects.length; ++i) {
                if (gameObjects[i].sid == sid) {
                    tmpObj = gameObjects[i];
                    break;
                }
            }

            if (!tmpObj) {
                for (var i = 0; i < gameObjects.length; ++i) {
                    if (!gameObjects[i].active) {
                        tmpObj = gameObjects[i];
                        break;
                    }
                }
            }

            if (!tmpObj) {
                tmpObj = new GameObject(sid);
                gameObjects.push(tmpObj);
            }

            if (setSID) tmpObj.sid = sid;

            tmpObj.init(x, y, dir, s, type, data, owner);

            if (server) {
                this.setObjectGrids(tmpObj);
                if (tmpObj.doUpdate) this.updateObjects.push(tmpObj);
            }

            return tmpObj;
        };
	// disabled by sid
        this.disableBySid = function(sid) {
            for (var i = 0; i < gameObjects.length; ++i) {
                if (gameObjects[i].sid == sid) {
                    this.disableObj(gameObjects[i]);
                    break;
                }
            }
        };
	// remove all items from player
        this.removeAllItems = function(sid, server) {
            for (var i = 0; i < gameObjects.length; ++i) {
                if (gameObjects[i].active && gameObjects[i].owner && gameObjects[i].owner.sid == sid) {
                    this.disableObj(gameObjects[i]);
                }
            }
            if (server) server.broadcast("R", sid);
        };
	// fetches spawn objects
        this.fetchSpawnObj = function(sid) {
            var tmpLoc = null;
            for (var i = 0; i < gameObjects.length; ++i) {
                var obj = gameObjects[i];
                if (obj.active && obj.owner && obj.owner.sid == sid && obj.spawnPoint) {
                    tmpLoc = [obj.x, obj.y];
                    this.disableObj(obj);
                    if (server) server.broadcast("Q", obj.sid);
                    if (obj.owner) obj.owner.changeItemCount(obj.group.id, -1);
                    break;
                }
            }
            return tmpLoc;
        };
	// check if item placeable
        this.checkItemLocation = function(x, y, s, sM, indx, ignoreWater, placer) {
            for (var i = 0; i < gameObjects.length; ++i) {
                var blockS = gameObjects[i].blocker ? gameObjects[i].blocker : gameObjects[i].getScale(sM, gameObjects[i].isItem);
                if (gameObjects[i].active && UTILS.getDistance(x, y, gameObjects[i].x, gameObjects[i].y) < s + blockS) {
                    return false;
                }
            }
            if (!ignoreWater && indx != 18 && y >= config.mapScale / 2 - config.riverWidth / 2 && y <= config.mapScale / 2 + config.riverWidth / 2) {
                return false;
            }
            return true;
        };
	// adds projectiles
        this.addProjectile = function(x, y, dir, range, indx) {
            var tmpData = items.projectiles[indx];
            var tmpProj;
            for (var i = 0; i < projectiles.length; ++i) {
                if (!projectiles[i].active) {
                    tmpProj = projectiles[i];
                    break;
                }
            }
            if (!tmpProj) {
                tmpProj = new Projectile(players, UTILS);
                projectiles.push(tmpProj);
            }
            tmpProj.init(indx, x, y, dir, tmpData.speed, range, tmpData.scale);
        };
	// checks players collision
        this.checkCollision = function(player, other, delta) {
            delta = delta || 1;
            var dx = player.x - other.x;
            var dy = player.y - other.y;
            var tmpLen = player.scale + other.scale;
            if (mathABS(dx) <= tmpLen || mathABS(dy) <= tmpLen) {
                tmpLen = player.scale + (other.getScale ? other.getScale() : other.scale);
                var tmpInt = mathSQRT(dx * dx + dy * dy) - tmpLen;
                if (tmpInt <= 0) {
                    if (!other.ignoreCollision) {
                        var tmpDir = UTILS.getDirection(player.x, player.y, other.x, other.y);

                        if (other.isPlayer) {
                            tmpInt = tmpInt * -1 / 2;
                            player.x += tmpInt * mathCOS(tmpDir);
                            player.y += tmpInt * mathSIN(tmpDir);
                            other.x -= tmpInt * mathCOS(tmpDir);
                            other.y -= tmpInt * mathSIN(tmpDir);
                        } else {
                            player.x = other.x + tmpLen * mathCOS(tmpDir);
                            player.y = other.y + tmpLen * mathSIN(tmpDir);
                            player.xVel *= 0.75;
                            player.yVel *= 0.75;
                        }
                        if (other.dmg && other.owner != player && !(other.owner && other.owner.team && other.owner.team == player.team)) {
                            player.changeHealth(-other.dmg, other.owner, other);
                            var tmpSpd = 1.5 * (other.weightM || 1);
                            player.xVel += tmpSpd * mathCOS(tmpDir);
                            player.yVel += tmpSpd * mathSIN(tmpDir);
                            if (other.pDmg && !(player.skin && player.skin.poisonRes)) {
                                player.dmgOverTime.dmg = other.pDmg;
                                player.dmgOverTime.time = 5;
                                player.dmgOverTime.doer = other.owner;
                            }
                            if (player.colDmg && other.health) {
                                if (other.changeHealth(-player.colDmg)) {
                                    this.disableObj(other);
                                }
                                this.hitObj(other, UTILS.getDirection(player.x, player.y, other.x, other.y));
                            }
                        }
                    } else {
                        if (other.trap && !player.noTrap && other.owner != player && !(other.owner && other.owner.team && other.owner.team == player.team)) {
                            player.lockMove = true;
                            other.hideFromEnemy = false;
                        } else {
                            if (other.boostSpeed) {
                                player.xVel += delta * other.boostSpeed * (other.weightM || 1) * mathCOS(other.dir);
                                player.yVel += delta * other.boostSpeed * (other.weightM || 1) * mathSIN(other.dir);
                            } else {
                                if (other.healCol) {
                                    player.healCol = other.healCol;
                                } else {
                                    if (other.teleport) {
                                        player.x = UTILS.randInt(0, config.mapScale);
                                        player.y = UTILS.randInt(0, config.mapScale);
                                    }
                                }
                            }
                        }
                    }
                    if (other.zIndex > player.zIndex) player.zIndex = other.zIndex;
                    return true;
                }
            }
            return false;
        };
    };
}
