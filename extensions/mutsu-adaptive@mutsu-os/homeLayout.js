// Home screen arrangement: one ordered list of apps and folders, paged by
// the current grid size so rotation reflows instead of clipping. Pure data,
// persisted as JSON in the extension's `home-layout` setting.

const STEAM = ['steam.desktop', 'com.valvesoftware.Steam.desktop'];

export function itemId(item) {
    return typeof item === 'string' ? item : `folder:${item.id}`;
}

export class HomeLayout {
    constructor(json = '') {
        this.items = [];
        this._nextFolder = 1;
        try {
            const data = json ? JSON.parse(json) : null;
            if (data && Array.isArray(data.items))
                this.items = data.items.filter(item => typeof item === 'string' ||
                    (item && Array.isArray(item.apps) && item.id !== undefined))
                    .map(item => typeof item === 'string' ? item
                        : {id: String(item.id), name: String(item.name ?? 'Folder'),
                            apps: item.apps.filter(app => typeof app === 'string')});
        } catch (e) {
            this.items = [];
        }
        for (const item of this.items) {
            if (typeof item !== 'string')
                this._nextFolder = Math.max(this._nextFolder, (parseInt(item.id, 10) || 0) + 1);
        }
    }

    get empty() { return this.items.length === 0; }

    // First run: alphabetical, with games gathered in a folder (Steam stays
    // on the grid). `apps` is [{id, name, categories: string[]}].
    seed(apps) {
        const sorted = [...apps].sort((a, b) => a.name.localeCompare(b.name));
        const games = sorted.filter(app => app.categories.includes('Game') && !STEAM.includes(app.id));
        const gameIds = new Set(games.length >= 2 ? games.map(app => app.id) : []);
        this.items = sorted.filter(app => !gameIds.has(app.id)).map(app => app.id);
        if (gameIds.size)
            this.items.push({id: String(this._nextFolder++), name: 'Games', apps: [...gameIds]});
        return this;
    }

    // Keep only installed apps; append new installs at the end.
    sync(installed) {
        const present = new Set(installed);
        const seen = new Set();
        const next = [];
        for (const item of this.items) {
            if (typeof item === 'string') {
                if (present.has(item) && !seen.has(item)) {
                    seen.add(item);
                    next.push(item);
                }
                continue;
            }
            item.apps = item.apps.filter(app => present.has(app) && !seen.has(app));
            item.apps.forEach(app => seen.add(app));
            if (item.apps.length >= 2)
                next.push(item);
            else if (item.apps.length === 1)
                next.push(item.apps[0]);
        }
        for (const app of installed) {
            if (!seen.has(app)) {
                seen.add(app);
                next.push(app);
            }
        }
        const changed = JSON.stringify(next) !== JSON.stringify(this.items);
        this.items = next;
        return changed;
    }

    pages(perPage) {
        const size = Math.max(1, perPage);
        const pages = [];
        for (let i = 0; i < this.items.length; i += size)
            pages.push(this.items.slice(i, i + size));
        return pages.length ? pages : [[]];
    }

    indexOf(id) {
        return this.items.findIndex(item => itemId(item) === id);
    }

    folder(id) {
        return this.items.find(item => typeof item !== 'string' && itemId(item) === id) ?? null;
    }

    // Reorder: the moved item lands at `index` in the list after removal.
    move(id, index) {
        const from = this.indexOf(id);
        if (from < 0)
            return false;
        const [item] = this.items.splice(from, 1);
        const to = Math.max(0, Math.min(this.items.length, index));
        this.items.splice(to, 0, item);
        return from !== to;
    }

    // Drop an app onto another app (new folder) or onto a folder (join it).
    dropOnto(id, targetId, name = 'Folder') {
        if (id === targetId || id.startsWith('folder:'))
            return false;
        const from = this.indexOf(id);
        const target = this.indexOf(targetId);
        if (from < 0 || target < 0)
            return false;
        const targetItem = this.items[target];
        if (typeof targetItem !== 'string') {
            targetItem.apps.push(id);
            this.items.splice(from, 1);
            return true;
        }
        const folder = {id: String(this._nextFolder++), name, apps: [targetItem, id]};
        this.items[target] = folder;
        this.items.splice(from, 1);
        return true;
    }

    removeFromFolder(folderId, app) {
        const index = this.indexOf(folderId);
        const folder = this.items[index];
        if (!folder || typeof folder === 'string' || !folder.apps.includes(app))
            return false;
        folder.apps = folder.apps.filter(a => a !== app);
        const replacement = folder.apps.length >= 2 ? [folder, app] : [...folder.apps, app];
        this.items.splice(index, 1, ...replacement);
        return true;
    }

    renameFolder(folderId, name) {
        const folder = this.folder(folderId);
        if (!folder || !name.trim())
            return false;
        folder.name = name.trim();
        return true;
    }

    serialize() {
        return JSON.stringify({version: 1, items: this.items});
    }
}
