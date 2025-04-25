//% block="Better Overlaps"
//% color="#FB8C00" icon="\uf259"
//% groups="['Overlaps']"
namespace overlaps {
    export const SPRITE_DATA_KEY = "@$_events_sprite_data";

    export enum SpriteEvent {
        //% block="starts overlapping"
        StartOverlapping,
        //% block="stops overlapping"
        StopOverlapping
    }

    export enum TileEvent {
        //% block="starts overlapping"
        StartOverlapping,
        //% block="stops overlapping"
        StopOverlapping,
        //% block="fully within"
        Enters,
        //% block="no longer fully within"
        Exits,
        //% block="fully within area covered by"
        EntersArea,
        //% block="no longer fully within area covered by"
        ExitsArea
    }

    enum TileFlag {
        Overlapping = 1 << 0,
        FullyWithin = 1 << 1,
        WithinArea = 1 << 2
    }

    type SpriteHandler = (sprite: Sprite, otherSprite: Sprite) => void;
    type TileHandler = (sprite: Sprite, location: tiles.Location) => void;

    let stateStack: EventState[];

    class EventState {
        spriteHandlers: SpriteHandlerEntry[];
        tileHandlers: TileHandlerEntry[];
        trackedSprites: Sprite[];

        constructor() {
            this.spriteHandlers = [];
            this.tileHandlers = [];
            this.trackedSprites = [];

            game.eventContext().registerFrameHandler(scene.PHYSICS_PRIORITY + 1, () => {
                this.update();
            });
        }

        update() {
            for (const sprite of this.trackedSprites) {
                if (!sprite || sprite.flags & sprites.Flag.Destroyed) continue;

                const data = sprite.data[SPRITE_DATA_KEY] as SpriteEventData;
                if (!data) continue;

                for (let i = data.overlappingSprites.length - 1; i >= 0; i--) {
                    const otherSprite = data.overlappingSprites[i];
                    if (!otherSprite || otherSprite.flags & sprites.Flag.Destroyed || !sprite.overlapsWith(otherSprite)) {
                        data.overlappingSprites.removeElement(otherSprite);
                        if (!otherSprite || otherSprite.flags & sprites.Flag.Destroyed) continue;

                        const handler = this.getSpriteHandler(SpriteEvent.StopOverlapping, sprite.kind(), otherSprite.kind());
                        if (handler) handler.handler(sprite, otherSprite);
                    }
                }

                const tileMap = game.currentScene().tileMap;
                if (tileMap) {
                    for (const handler of this.tileHandlers) {
                        if (handler.kind === sprite.kind()) {
                            const targetTileIndex = tileMap.getImageType(handler.tile);
                            if (targetTileIndex !== -1) {
                                updateTileStateAndFireEvents(
                                    sprite,
                                    targetTileIndex,
                                    tileMap,
                                    undefined
                                );
                            }
                        }
                    }
                }
            }
            this.pruneTrackedSprites();
        }

        getSpriteHandler(event: SpriteEvent, kind: number, otherKind: number) {
            for (const handler of this.spriteHandlers) {
                if (handler.event === event && handler.kind === kind && handler.otherKind === otherKind)
                    return handler;
            }
            return undefined;
        }

        getTileHandler(event: TileEvent, kind: number, image: Image) {
            for (const handler of this.tileHandlers) {
                if (handler.event === event && handler.kind === kind && handler.tile && handler.tile.equals(image))
                    return handler;
            }
            return undefined;
        }

        protected pruneTrackedSprites() {
            for (let i = this.trackedSprites.length - 1; i >= 0; i--) {
                const sprite = this.trackedSprites[i];
                if (!sprite || sprite.flags & sprites.Flag.Destroyed) {
                    this.trackedSprites.removeAt(i);
                }
            }
        }
    }

    class SpriteHandlerEntry {
        constructor(
            public event: SpriteEvent,
            public kind: number,
            public otherKind: number,
            public handler: SpriteHandler
        ) { }
    }

    class TileHandlerEntry {
        constructor(
            public event: TileEvent,
            public kind: number,
            public tile: Image,
            public handler: TileHandler
        ) { }
    }

    class SpriteEventData {
        overlappingSprites: Sprite[];
        tiles: TileState[];

        constructor(public owner: Sprite) {
            this.overlappingSprites = [];
            this.tiles = [];
        }

        getTileEntry(tileIndex: number, createIfMissing = false) {
            for (const tile of this.tiles) {
                if (tile.tileIndex === tileIndex) {
                    return tile;
                }
            }

            if (createIfMissing) {
                const newEntry = new TileState(tileIndex);
                this.tiles.push(newEntry)
                return newEntry;
            }
            return undefined;
        }
    }

    class TileState {
        flag: number;
        lastKnownLocation?: tiles.Location;
        constructor(public tileIndex: number, flag = 0) {
            this.flag = flag;
        }
    }

    function init() {
        if (stateStack) return;
        stateStack = [new EventState()];

        game.addScenePushHandler(() => {
            stateStack.push(new EventState());
        });

        game.addScenePopHandler(() => {
            if (stateStack.length > 1) {
                stateStack.pop();
            }
            if (stateStack.length === 0) {
                stateStack.push(new EventState());
            }
        });
    }

    function state() {
        init();
        return stateStack[stateStack.length - 1];
    }

    //% blockId=sprite_overlap_sprite_event
    //% block="on $sprite of kind $kind $event with $otherSprite of kind $otherKind"
    //% draggableParameters="reporter"
    //% kind.shadow=spritekind
    //% otherKind.shadow=spritekind
    //% group="Overlaps"
    export function spriteEvent(kind: number, otherKind: number, event: SpriteEvent, handler: (sprite: Sprite, otherSprite: Sprite) => void) {
        init();

        const existing = state().getSpriteHandler(event, kind, otherKind);
        if (existing) {
            existing.handler = handler;
            return;
        }

        state().spriteHandlers.push(
            new SpriteHandlerEntry(event, kind, otherKind, handler)
        );

        sprites.onOverlap(kind, otherKind, (sprite, otherSprite) => {
            const currentState = state();
            if (!sprite || !otherSprite || sprite.flags & sprites.Flag.Destroyed || otherSprite.flags & sprites.Flag.Destroyed) return;

            if (!sprite.data[SPRITE_DATA_KEY]) {
                sprite.data[SPRITE_DATA_KEY] = new SpriteEventData(sprite);
                if (currentState.trackedSprites.indexOf(sprite) === -1) {
                    currentState.trackedSprites.push(sprite);
                }
            }

            const data: SpriteEventData = sprite.data[SPRITE_DATA_KEY];
            if (!data) return;
            const isOverlappingAlready = data.overlappingSprites.indexOf(otherSprite) !== -1;

            if (!isOverlappingAlready) {
                data.overlappingSprites.push(otherSprite);

                const startHandler = currentState.getSpriteHandler(SpriteEvent.StartOverlapping, kind, otherKind)
                if (startHandler) {
                    startHandler.handler(sprite, otherSprite);
                }
            }
        });
    }

    //% blockId=sprite_overlap_tile_event
    //% block="on $sprite of kind $kind $event tile $tile at $location"
    //% draggableParameters="reporter"
    //% kind.shadow=spritekind
    //% tile.shadow=tileset_tile_picker
    //% tile.defl=assets.tile`myTile`
    //% group="Overlaps"
    export function tileEvent(kind: number, tile: Image, event: TileEvent, handler: (sprite: Sprite, location: tiles.Location) => void) {
        init();
        if (!tile) return;

        const existing = state().getTileHandler(event, kind, tile);
        if (existing) {
            existing.handler = handler;
            return;
        }

        state().tileHandlers.push(
            new TileHandlerEntry(event, kind, tile, handler)
        );

        scene.onOverlapTile(kind, tile, (sprite, location) => {
            if (!sprite || !location) return;
            const tileMapInstance = game.currentScene().tileMap;
            if (!tileMapInstance) return;

            const tileIndex = tileMapInstance.getImageType(tile);

            if (tileIndex !== -1) {
                updateTileStateAndFireEvents(sprite, tileIndex, tileMapInstance, location);
            }
        });
    }

    function updateTileStateAndFireEvents(sprite: Sprite, tileIndex: number, map: tiles.TileMap, specificLocation?: tiles.Location) {
        if (!sprite || !map) return;
        let data: SpriteEventData = sprite.data[SPRITE_DATA_KEY];

        if (!data) {
            data = new SpriteEventData(sprite);
            sprite.data[SPRITE_DATA_KEY] = data;
            if (state().trackedSprites.indexOf(sprite) === -1) {
                state().trackedSprites.push(sprite);
            }
        }

        const tileState = data.getTileEntry(tileIndex, true);
        const oldFlags = tileState.flag;
        // Before updating the state, preserve the last known specific location if it's about to be "started"
        // This is important if specificLocation is only provided on the exact frame of starting.
        let previousSpecificLocationForThisTile = tileState.lastKnownLocation;

        updateTileState(tileState, sprite, tileIndex, map); // This updates flags

        if (oldFlags === tileState.flag) return; // No change in state, no events to fire

        const tileImageForHandler = map.getTileImage(tileIndex);
        if (!tileImageForHandler) return;

        const currentState = state();

        // Default location for events not tied to a specific instance trigger or if no better one is found
        const fallbackLocation = sprite.tilemapLocation();

        if (tileState.flag & TileFlag.Overlapping) {
            if (!(oldFlags & TileFlag.Overlapping)) { // Just started overlapping
                const handler = currentState.getTileHandler(TileEvent.StartOverlapping, sprite.kind(), tileImageForHandler);
                if (handler) {
                    // When starting, specificLocation IS the tile's location. Store it.
                    if (specificLocation) {
                        tileState.lastKnownLocation = specificLocation;
                        handler.handler(sprite, specificLocation);
                    } else {
                        // This case (starting overlap without a specificLocation) should be rare if
                        // scene.onOverlapTile is the primary trigger. Fallback if necessary.
                        tileState.lastKnownLocation = fallbackLocation; // Store fallback if no specific one
                        handler.handler(sprite, fallbackLocation);
                    }
                }
            }
        } else if (oldFlags & TileFlag.Overlapping) { // Was overlapping, now it's not (Stopped Overlapping)
            const handler = currentState.getTileHandler(TileEvent.StopOverlapping, sprite.kind(), tileImageForHandler);
            if (handler) {
                // Use the cached lastKnownLocation for the tile we just stopped overlapping.
                // If for some reason it wasn't cached (e.g., state initialized mid-overlap),
                // then fallback, but ideally it should be there from the StartOverlapping.
                const locationToReport = tileState.lastKnownLocation || previousSpecificLocationForThisTile || fallbackLocation;
                handler.handler(sprite, locationToReport);
                // Optionally, clear tileState.lastKnownLocation here if the tile is no longer relevant
                // or keep it if you want to know the last spot it touched that image.
                // For "stops overlapping", it's probably good to keep it for this handler call and then it can be cleared
                // if the tileState entry itself is removed (if flag becomes 0).
            }
        }

        // For other events, decide if specificLocation (if any), lastKnownLocation, or fallback is most appropriate
        // Enters, Exits, EntersArea, ExitsArea are more about the overall relationship with the tile *image*.
        // Using specificLocation if available (the tile that tipped the state) or fallback seems okay.
        // If these also need to refer to a "main" instance of the tile image, `lastKnownLocation` might be useful.
        const locationForAreaEvents = specificLocation || tileState.lastKnownLocation || fallbackLocation;

        if (tileState.flag & TileFlag.FullyWithin) {
            if (!(oldFlags & TileFlag.FullyWithin)) {
                const handler = currentState.getTileHandler(TileEvent.Enters, sprite.kind(), tileImageForHandler);
                if (handler) {
                    // If entering fully, specificLocation is the key. If it also just started overlapping, lastKnownLocation was set.
                    handler.handler(sprite, specificLocation || tileState.lastKnownLocation || fallbackLocation);
                }
            }
        } else if (oldFlags & TileFlag.FullyWithin) {
            const handler = currentState.getTileHandler(TileEvent.Exits, sprite.kind(), tileImageForHandler);
            if (handler) {
                // When exiting fully within, the 'lastKnownLocation' of that fully-within state is most relevant.
                handler.handler(sprite, tileState.lastKnownLocation || fallbackLocation);
            }
        }

        if (tileState.flag & TileFlag.WithinArea) {
            if (!(oldFlags & TileFlag.WithinArea)) {
                const handler = currentState.getTileHandler(TileEvent.EntersArea, sprite.kind(), tileImageForHandler);
                if (handler) handler.handler(sprite, locationForAreaEvents);
            }
        } else if (oldFlags & TileFlag.WithinArea) {
            const handler = currentState.getTileHandler(TileEvent.ExitsArea, sprite.kind(), tileImageForHandler);
            if (handler) handler.handler(sprite, locationForAreaEvents);
        }

        if (tileState.flag === 0) { // If all flags are gone for this tile image
            if (data.tiles.indexOf(tileState) !== -1) {
                // Before removing, consider if lastKnownLocation should be used one last time
                // for any "final stop" event if not handled above.
                // data.tiles.removeElement(tileState); // Already handled by StopOverlapping if that's the only flag
            }
            // If no flags are set, clear lastKnownLocation as it's no longer in any relevant state for this tile image
            tileState.lastKnownLocation = undefined;
            if (data.tiles.indexOf(tileState) !== -1 && tileState.flag === 0) { // ensure it's still in the list before removing
                data.tiles.removeElement(tileState);
            }
        }
    }

    function updateTileState(tileState: TileState, sprite: Sprite, tileIndexToMatch: number, map: tiles.TileMap) {
        const tileWidth = 1 << map.scale;

        const spriteL = sprite.left;
        const spriteT = sprite.top;
        const spriteR = sprite.right;
        const spriteB = sprite.bottom;

        const x0 = Math.idiv(spriteL, tileWidth);
        const y0 = Math.idiv(spriteT, tileWidth);
        const x1 = Math.idiv(spriteR, tileWidth);
        const y1 = Math.idiv(spriteB, tileWidth);

        tileState.flag = 0;

        if (x0 === x1 && y0 === y1) {
            if (x0 >= 0 && x0 < map.areaWidth() && y0 >= 0 && y0 < map.areaHeight()) {
                const currentTile = map.getTile(x0, y0);
                if (currentTile && currentTile.tileSet === tileIndexToMatch) {
                    tileState.flag = TileFlag.Overlapping | TileFlag.FullyWithin | TileFlag.WithinArea;
                }
            }
            return;
        }

        let isOverlappingTargetTile = false;
        let isSpriteFullyContainedInTargetTiles = true;

        for (let x = x0; x <= x1; x++) {
            for (let y = y0; y <= y1; y++) {
                if (x < 0 || x >= map.areaWidth() || y < 0 || y >= map.areaHeight()) {
                    isSpriteFullyContainedInTargetTiles = false;
                    continue;
                }

                const currentTile = map.getTile(x, y);
                if (currentTile && currentTile.tileSet === tileIndexToMatch) {
                    isOverlappingTargetTile = true;
                } else {
                    isSpriteFullyContainedInTargetTiles = false;
                }
            }
        }

        if (isOverlappingTargetTile) {
            tileState.flag |= TileFlag.Overlapping;
            if (isSpriteFullyContainedInTargetTiles) {
                tileState.flag |= TileFlag.WithinArea;
            }
        }
    }

    //% blockId=sprite_overlap_tile_bool
    //% block="$sprite is currently overlapping tile image $tileImage"
    //% sprite.shadow=variables_get
    //% sprite.defl=mySprite
    //% tileImage.shadow=tileset_tile_picker
    //% tileImage.defl=assets.tile`myTile`
    //% group="Overlaps"
    export function isSpriteOverlappingTileImage(sprite: Sprite, tileImage: Image): boolean {
        if (!sprite || !tileImage) {
            return false;
        }

        const scene = game.currentScene();
        const tm = scene.tileMap;

        if (!tm || tm.areaWidth() === 0 || tm.areaHeight() === 0) {
            return false;
        }

        const scale = 1 << tm.scale;

        const spriteL = sprite.left;
        const spriteR = sprite.right;
        const spriteT = sprite.top;
        const spriteB = sprite.bottom;

        const minCol = Math.max(0, Math.floor(spriteL / scale));
        const maxCol = Math.min(tm.areaWidth() - 1, Math.floor(spriteR / scale));
        const minRow = Math.max(0, Math.floor(spriteT / scale));
        const maxRow = Math.min(tm.areaHeight() - 1, Math.floor(spriteB / scale));

        for (let r = minRow; r <= maxRow; r++) {
            for (let c = minCol; c <= maxCol; c++) {
                const tileObject = tm.getTile(c, r);

                if (tileObject && tileObject.tileSet !== undefined) {
                    const tileId = tileObject.tileSet;
                    const currentTileImgFromMap = tm.getTileImage(tileId);

                    if (currentTileImgFromMap && currentTileImgFromMap.equals(tileImage)) {
                        const tileLeft = c * scale;
                        const tileTop = r * scale;
                        const tileRight = tileLeft + scale;
                        const tileBottom = tileTop + scale;

                        if (spriteL < tileRight &&
                            spriteR > tileLeft &&
                            spriteT < tileBottom &&
                            spriteB > tileTop) {
                            return true;
                        }
                    }
                }
            }
        }
        return false;
    }
}