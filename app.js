import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, doc, setDoc, getDoc, updateDoc, deleteDoc, arrayUnion, arrayRemove, onSnapshot, query, orderBy, where, limit, increment, runTransaction } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

// --- КОНФИГ FIREBASE (Вставь свои ключи!) ---
const firebaseConfig = {
    apiKey: "AIzaSyBCcBSZx6kAFGwTscJlfDuiQILGZDaVN4g",
    authDomain: "mysocnet-34ee9.firebaseapp.com",
    projectId: "mysocnet-34ee9",
    storageBucket: "mysocnet-34ee9.firebasestorage.app",
    messagingSenderId: "82449086862",
    appId: "1:82449086862:web:e77a61b33a54be97a00cdf",
    measurementId: "G-4Z2SMZS5N4"
};

const fbApp = initializeApp(firebaseConfig);
const db = getFirestore(fbApp);

// --- ГЛОБАЛЫ ---
window.currentUser = null;
let listeners = {};
let tempImg = null;       
let tempChatImg = null;   
let tempAv = null;        
let activeGame = null;    
let gameTimerInt = null;
let activeGroupId = null;
let curChat = null;       
let activeChatUnsub = null;
let selectedSlot = null; // Для закрепа эмодзи

// БАЗА ПРЕДМЕТОВ
const ITEMS_DB = {
    tools: ['🔫', '🥛', '🎨', '🖌️'], 
    emojis: ['🤡', '👻', '👺', '💀', '👽', '💩', '🤖', '👾', '🎃', '😺', '🙉', '🦊', '🌚', '🍕', '🍔', '🍟', '🌭'],
    mythical: ['🐲', '🦄', '👑', '💎']
};

// --- ХЕЛПЕРЫ ---
const compress = (file, cb) => {
    const r = new FileReader(); r.readAsDataURL(file);
    r.onload = e => { const i = new Image(); i.src = e.target.result; i.onload = () => { const c = document.createElement('canvas'); const max = 800; let w=i.width, h=i.height; if(w>h){if(w>max){h*=max/w;w=max}}else{if(h>max){w*=max/h;h=max}} c.width=w; c.height=h; c.getContext('2d').drawImage(i,0,0,w,h); cb(c.toDataURL('image/jpeg', 0.8)); } }
};

// Генератор аватарок (с закрепами)
const getAv = (u, sz, addFrame=false) => {
    if(!u) return '';
    let src = u.avatar || u.authorAvatar || 'https://via.placeholder.com/80';
    let frameClass = '', satellites = '';
    
    const inv = u.inventory || u.authorInventory || [];
    const pins = u.pinnedEmojis || {}; // { slot1: "🤡", slot2: "🔫" }

    if(addFrame && inv.length > 0) {
        if(inv.some(i => i.rarity === 'mythical')) frameClass = 'rarity-mythical';
        else if(inv.some(i => i.rarity === 'legendary')) frameClass = 'rarity-legendary';
    }
    
    if(pins.slot1) satellites += `<span class="sat-icon sat-1">${pins.slot1}</span>`;
    if(pins.slot2) satellites += `<span class="sat-icon sat-2">${pins.slot2}</span>`;

    return `<div class="avatar-wrap"><img src="${src}" class="avatar ${sz} ${frameClass}">${satellites}</div>`;
};

const parseTime = ts => new Date(ts).toLocaleDateString();
const parseText = (txt) => txt ? txt.replace(/@([a-zA-Z0-9_]+)/g, '<b style="color:var(--primary); cursor:pointer" onclick="event.stopPropagation(); window.ui.nav(\'profile\', \'$1\')">@$1</b>') : '';

// --- UI NAVIGATOR ---
window.ui = {
    nav: (v, p) => {
        if(activeChatUnsub) { activeChatUnsub(); activeChatUnsub = null; }
        if(v === 'profile' && !p) p = currentUser.username;
        
        document.querySelectorAll('.view').forEach(e => e.classList.remove('active'));
        document.querySelectorAll('.nav-item').forEach(e => e.classList.remove('active'));
        document.querySelectorAll('.modal-overlay').forEach(e => e.classList.add('hidden'));

        if(v === 'chat-room') document.getElementById('view-chat-room').classList.remove('hidden');
        else {
            document.getElementById('view-chat-room').classList.add('hidden');
            const el = document.getElementById('view-'+(v==='admin'?'admin':v));
            if(el) el.classList.add('active');
        }
        
        const map = {'feed':0, 'market':1, 'groups':2, 'chats':3, 'rich':4, 'profile':5, 'admin':6, 'search':7, 'settings':8};
        const items = document.querySelectorAll('.nav-item');
        if(map[v] !== undefined && items[map[v]]) items[map[v]].classList.add('active');

        if(v==='feed') window.app.loadFeed();
        if(v==='chats') window.app.loadChats();
        if(v==='market') window.market.tab('cases');
        if(v==='rich') window.app.loadRich();
        if(v==='profile') window.app.loadProfile(p);
        if(v==='chat-room') window.app.loadChatRoom(p);
        if(v==='groups') window.app.loadGroups();
        if(v==='admin') window.admin.tab('users');
        if(v==='settings') {
            document.getElementById('settings-bal').innerText = currentUser.balance;
            document.getElementById('settings-tickets').innerText = currentUser.tickets || 0;
            if(currentUser.isAdmin) document.getElementById('settings-admin-btn').classList.remove('hidden');
        }
    },
    closeModals: () => {
        document.querySelectorAll('.modal-overlay').forEach(e => e.classList.add('hidden'));
    },
    toggleAuth: (mode) => { document.getElementById('login-box').classList.toggle('hidden', mode!=='login'); document.getElementById('reg-box').classList.toggle('hidden', mode!=='reg'); },
    togglePass: (id) => { const el = document.getElementById(id); el.type = el.type==='password'?'text':'password'; },
    setTab: (t, btn) => {
        document.querySelectorAll('.set-page').forEach(e=>e.classList.add('hidden'));
        document.getElementById('set-'+t).classList.remove('hidden');
        document.querySelectorAll('#view-settings .tab').forEach(e=>e.classList.remove('active'));
        btn.classList.add('active');
    },
    theme: () => {
        const d = document.getElementById('theme-switch').checked;
        if(d) document.body.classList.add('dark'); else document.body.classList.remove('dark');
        localStorage.setItem('theme', d ? 'dark' : 'light');
    }
};

// --- APP CORE ---
window.app = {
    init: async () => {
        const t = localStorage.getItem('theme');
        if(t === 'dark') { document.body.classList.add('dark'); document.getElementById('theme-switch').checked = true; }

        const u = localStorage.getItem('user');
        if(u) {
            const s = await getDoc(doc(db, 'users', u));
            if(s.exists()) {
                currentUser = s.data();
                
                // MIGRATION
                let fix = {};
                if(!currentUser.tickets) fix.tickets = 0;
                if(!currentUser.pinnedEmojis) fix.pinnedEmojis = {};
                if(!currentUser.graffiti) fix.graffiti = null;
                if(Object.keys(fix).length > 0) { 
                    await updateDoc(doc(db, 'users', u), fix); 
                    currentUser = {...currentUser, ...fix}; 
                }
                
                if(currentUser.isBanned) return alert('ВАШ АККАУНТ ЗАБЛОКИРОВАН');
                
                document.getElementById('auth-screen').classList.add('hidden');
                document.getElementById('app-screen').classList.remove('hidden');
                if(currentUser.isAdmin) document.getElementById('nav-admin').classList.remove('hidden');
                
                window.ui.nav('feed');
            }
        }
        document.getElementById('splash').classList.add('hidden');
    },
    login: async () => {
        const u = document.getElementById('login-user').value.toLowerCase().trim();
        const p = document.getElementById('login-pass').value;
        const s = await getDoc(doc(db, 'users', u));
        if(s.exists() && s.data().password === p) {
            if(s.data().isBanned) return alert('BAN');
            localStorage.setItem('user', u);
            location.reload();
        } else alert('Ошибка входа');
    },
    register: async () => {
        const u = document.getElementById('reg-user').value.toLowerCase().trim();
        const n = document.getElementById('reg-name').value;
        const p = document.getElementById('reg-pass').value;
        if(u.length < 3) return alert('Короткий ник');
        
        await setDoc(doc(db, 'users', u), { 
            username: u, name: n, password: p, 
            balance: 10, tickets: 0, inventory: [], pinnedEmojis: {}, 
            followers:[], following:[], blocked:[], 
            isAdmin:false, isVerified:false, createdAt: Date.now() 
        });
        alert('Готово! Войдите.'); window.ui.toggleAuth('login');
    },
    logout: () => { localStorage.clear(); location.reload(); },
    // --- AVATAR & PINNING SYSTEM (NEW) ---
    openAvatarMenu: () => {
        document.getElementById('avatar-menu-modal').classList.remove('hidden');
        // Отображаем текущие закрепы
        const pins = currentUser.pinnedEmojis || {};
        document.getElementById('slot1-view').innerText = pins.slot1 || '➕';
        document.getElementById('slot2-view').innerText = pins.slot2 || '➕';
    },

    manageSlot: (slot) => {
        selectedSlot = slot;
        document.getElementById('avatar-menu-modal').classList.add('hidden');
        document.getElementById('item-select-modal').classList.remove('hidden');
        
        const c = document.getElementById('item-select-list'); c.innerHTML = '';
        // Фильтруем только Эмодзи (не инструменты)
        const emojis = currentUser.inventory.filter(i => !ITEMS_DB.tools.includes(i.emoji));
        
        if(emojis.length === 0) c.innerHTML = '<p style="padding:10px">Нет эмодзи. Купите кейс!</p>';
        
        emojis.forEach(i => {
            c.innerHTML += `<div class="market-item rarity-${i.rarity}" onclick="window.app.equipItem('${i.emoji}')">
                <span style="font-size:30px">${i.emoji}</span>
            </div>`;
        });
        
        // Кнопка снятия
        document.getElementById('unequip-btn').onclick = () => window.app.equipItem(null);
    },

    equipItem: async (emoji) => {
        const upd = {};
        upd[`pinnedEmojis.${selectedSlot}`] = emoji ? emoji : deleteField(); // deleteField import needed or just update whole object
        
        // Проще обновить весь объект
        const newPins = { ...currentUser.pinnedEmojis };
        if(emoji) newPins[selectedSlot] = emoji;
        else delete newPins[selectedSlot];
        
        await updateDoc(doc(db, 'users', currentUser.username), { pinnedEmojis: newPins });
        currentUser.pinnedEmojis = newPins; // Local update
        
        alert(emoji ? 'Закреплено!' : 'Снято!');
        window.ui.closeModals();
        window.app.loadProfile(currentUser.username); // Refresh profile
    },

    // --- POSTS SYSTEM ---
    openCreatePost: () => { 
        document.getElementById('create-post-modal').classList.remove('hidden'); 
        window.app.setPostType('normal', document.querySelector('.tab.active')); 
    },
    
    setPostType: (type, btn) => {
        document.getElementById('post-type-normal').classList.toggle('hidden', type !== 'normal');
        document.getElementById('post-type-magazine').classList.toggle('hidden', type !== 'magazine');
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        if(btn) btn.classList.add('active');
        window.currentPostType = type;
    },

    handleImg: (el) => { 
        if(el.files[0]) compress(el.files[0], d => { 
            tempImg = d; 
            document.getElementById('preview-img-el').src=d; 
            document.getElementById('post-img-preview').classList.remove('hidden'); 
        }); 
    },
    clearImg: () => { tempImg = null; document.getElementById('post-img-preview').classList.add('hidden'); },

    createPost: async () => {
        const type = window.currentPostType || 'normal';
        let content = '', images = [], actionBtn = null;
        
        const btnText = document.getElementById('post-btn-text').value;
        const btnLink = document.getElementById('post-btn-link').value;
        if(btnText && btnLink) actionBtn = { text: btnText, link: btnLink };

        if(type === 'normal') {
            content = document.getElementById('post-text').value;
            if(tempImg) images.push(tempImg);
        } else {
            content = document.getElementById('mag-text').value;
            // В полной версии тут сбор 5 фото, пока упрощено для стабильности
            if(tempImg) images.push(tempImg); 
        }

        if(!content && images.length === 0) return alert('Пустой пост!');
        
        await addDoc(collection(db, 'posts'), {
            author: currentUser.username, 
            name: currentUser.name, 
            content: content, 
            image: images[0] || null, 
            type: type,
            actionBtn: actionBtn,
            likes: [], 
            createdAt: Date.now(),
            approved: true, // Auto-approve for now (add mod logic if needed)
            authorInventory: currentUser.inventory, 
            pinnedEmojis: currentUser.pinnedEmojis,
            groupId: activeGroupId
        });
        
        alert('Опубликовано!');
        document.getElementById('post-text').value = ''; 
        window.app.clearImg(); 
        window.ui.closeModals();
        if(activeGroupId) window.app.loadProfile(activeGroupId);
    },

    loadFeed: () => {
        if(listeners.feed) listeners.feed();
        const q = query(collection(db, 'posts'), orderBy('createdAt', 'desc'), limit(30));
        listeners.feed = onSnapshot(q, s => {
            let html = '';
            s.forEach(d => {
                const p = d.data(); p.id = d.id;
                if(!p.approved) return;
                if(p.groupId) return;
                if(currentUser.blocked && currentUser.blocked.includes(p.author)) return;
                html += window.app.renderPost(p);
            });
            document.getElementById('feed-content').innerHTML = html;
        });
    },

    renderPost: (p) => {
        const fakeUser = { avatar: p.avatar, authorAvatar: p.authorAvatar, inventory: p.authorInventory, pinnedEmojis: p.pinnedEmojis };
        
        let mediaHtml = '';
        if(p.type === 'magazine' && p.images && p.images.length > 0) {
            // Magazine Layout logic (placeholder if array exists)
            mediaHtml = `<div class="mag-grid">${p.images.map(src => `<img src="${src}" class="mag-item">`).join('')}</div>`;
        } else if(p.image) {
            mediaHtml = `<img src="${p.image}" class="post-img" onclick="window.open('${p.image}')">`;
        }

        const actionHtml = p.actionBtn ? `<a href="${p.actionBtn.link}" target="_blank" class="action-btn-link">${p.actionBtn.text}</a>` : '';
        
        return `<div class="card">
            <div class="user-row" onclick="window.ui.nav('profile','${p.author}')">
                ${getAv(fakeUser, 'av-40', true)}
                <div>
                    <b>${p.name}</b> ${p.verified?'<span class="verified-icon">✓</span>':''}
                    <br><small class="post-date">${parseTime(p.createdAt)}</small>
                </div>
            </div>
            <div style="margin:10px 0; white-space:pre-wrap;">${parseText(p.content)}</div>
            ${mediaHtml}
            ${actionHtml}
            <div class="user-row" style="margin-top:10px; justify-content:space-between; position:relative; z-index:2;">
                <button class="action-btn btn-sec" onclick="window.app.like('${p.id}', '${p.author}')">❤️ ${p.likes?.length||0}</button>
                <button class="action-btn btn-sec" onclick="window.app.openComs('${p.id}')">💬</button>
                ${currentUser.isAdmin || p.author===currentUser.username ? `<button class="action-btn btn-danger sm-btn" onclick="window.app.delPost('${p.id}')">🗑️</button>` : ''}
            </div>
        </div>`;
    },
    // --- PROFILE SYSTEM ---
    loadProfile: async (u) => {
        const c = document.getElementById('profile-head');
        const pc = document.getElementById('profile-posts');
        c.innerHTML = 'Загрузка...'; pc.innerHTML = '';
        activeGroupId = null;

        const s = await getDoc(doc(db, 'users', u));
        if(s.exists()) {
            const user = s.data();
            const isMe = u === currentUser.username;
            const isFollow = currentUser.following.includes(u);
            const isBlocked = currentUser.blocked && currentUser.blocked.includes(u);
            
            // GRAFFITI WALL
            let wallHtml = '';
            if(user.graffiti) {
                wallHtml = `<div class="card" style="background:#222; color:white; text-align:center;">
                    <small>Стена (by ${user.graffiti.author})</small>
                    <img src="${user.graffiti.img}" style="width:100%; border-radius:5px; margin-top:5px;">
                </div>`;
            }

            let btns = '';
            if(isMe) {
                btns = `<button class="action-btn sm-btn" onclick="window.ui.nav('settings')">Ред.</button>
                        <button class="action-btn sm-btn btn-sec" onclick="window.app.openAvatarMenu()">Украшения</button>`;
            } else {
                if(isBlocked) {
                    btns = `<button class="action-btn btn-sec" onclick="window.app.block('${u}', false)">Разблокировать</button>`;
                } else {
                    btns = `<button class="action-btn sm-btn" onclick="window.app.follow('${u}')">${isFollow?'Отписаться':'Подписаться'}</button> 
                            <button class="action-btn sm-btn btn-sec" onclick="window.ui.nav('chat-room','${u}')">Чат</button>
                            <button class="action-btn sm-btn btn-danger" onclick="window.app.block('${u}', true)">Блок</button>`;
                    
                    // TAGGER CHECK
                    const hasTagger = currentUser.inventory.find(i => i.emoji === '🔫');
                    if(hasTagger) {
                        btns += `<br><button class="action-btn full-width mt-10" style="background:#000" onclick="window.graffiti.open('${u}')">🖌️ ЗА ТЭГАТЬ</button>`;
                    }
                }
            }
            
            c.innerHTML = `
                ${wallHtml}
                <div class="card center-content">
                    ${getAv(user, 'av-80', true)}
                    <h2>${user.name} ${user.isVerified?'<span class="verified-icon">✓</span>':''}</h2>
                    <div style="color:gray">@${user.username}</div>
                    <div style="display:flex; justify-content:center; gap:20px; margin:10px;">
                        <b>${user.followers?.length||0} подп.</b>
                        <b>${user.following?.length||0} подписки</b>
                    </div>
                    ${btns}
                </div>`;
            
            const q = query(collection(db, 'posts'), where('author', '==', u));
            const ps = await getDocs(q);
            ps.forEach(d => { 
                const p = d.data(); p.id=d.id;
                if(!p.groupId && p.approved) pc.innerHTML += window.app.renderPost(p); 
            });

        } else {
            // Group Check
            const g = await getDoc(doc(db, 'groups', u));
            if(g.exists()) {
                activeGroupId = u;
                const group = g.data();
                c.innerHTML = `<div class="card center-content">
                    <h2>${group.name}</h2>
                    <p>${group.desc}</p>
                    <button class="action-btn" onclick="window.app.openCreatePost()">Пост</button>
                </div>`;
                const q = query(collection(db, 'posts'), where('groupId', '==', u));
                const ps = await getDocs(q);
                ps.forEach(d => pc.innerHTML += window.app.renderPost({...d.data(), id:d.id}));
            }
        }
    },
    
    // --- ACTIONS ---
    like: async (id, auth) => {
        const r = doc(db, 'posts', id);
        const p = (await getDoc(r)).data();
        if(p.likes.includes(currentUser.username)) await updateDoc(r, {likes: arrayRemove(currentUser.username)});
        else { 
            await updateDoc(r, {likes: arrayUnion(currentUser.username)}); 
            window.app.notify(auth, 'like', 'Лайк'); 
        }
    },
    follow: async (u) => {
        const me = doc(db, 'users', currentUser.username);
        const him = doc(db, 'users', u);
        if(currentUser.following.includes(u)) {
            await updateDoc(me, {following: arrayRemove(u)});
            await updateDoc(him, {followers: arrayRemove(currentUser.username)});
            currentUser.following = currentUser.following.filter(x=>x!==u);
        } else {
            await updateDoc(me, {following: arrayUnion(u)});
            await updateDoc(him, {followers: arrayUnion(currentUser.username)});
            currentUser.following.push(u);
            window.app.notify(u, 'sub', 'Подписка');
        }
        window.app.loadProfile(u);
    },
    delPost: async (id) => { if(confirm('Удалить пост?')) await deleteDoc(doc(db, 'posts', id)); window.ui.nav('feed'); },
    
    // --- CHAT SYSTEM ---
    loadChats: async () => {
        const c = document.getElementById('chats-list'); c.innerHTML = '';
        for(const f of currentUser.following) {
            const u = await getDoc(doc(db, 'users', f));
            if(u.exists()) c.innerHTML += `<div class="card user-row" onclick="window.ui.nav('chat-room','${f}')">${getAv(u.data(),'av-40')} <b>${u.data().name}</b></div>`;
        }
    },
    loadChatRoom: async (u) => {
        curChat = u;
        document.getElementById('chat-title').innerText = u;
        const id = [currentUser.username, u].sort().join('_');
        const c = document.getElementById('msg-container');
        
        // Load Decor
        const chatSnap = await getDoc(doc(db, 'chats', id));
        if(chatSnap.exists()) {
            const d = chatSnap.data();
            document.getElementById('chat-bg-layer').style.backgroundImage = d.bg ? `url('${d.bg}')` : '';
            document.getElementById('chat-fx-layer').style.backgroundImage = d.fx ? `url('${d.fx}')` : '';
        }

        if(activeChatUnsub) activeChatUnsub();
        const q = query(collection(db, 'chats', id, 'messages'), orderBy('time','asc'));
        activeChatUnsub = onSnapshot(q, s => {
            c.innerHTML = '';
            s.forEach(d => {
                const m = d.data();
                const isMe = m.from === currentUser.username;
                let content = m.text;
                if(m.image) content = `<img src="${m.image}" class="chat-img" onclick="window.open('${m.image}')">`;
                
                if(m.type === 'game_invite') {
                    const status = m.finished ? `Завершено. Победил: ${m.winner}` : `Ставка: ${m.bet} HC`;
                    // FIX: Prevent playing with self
                    const canPlay = !m.finished && !isMe;
                    const action = canPlay ? `onclick="window.game.start('${d.id}','${id}',${m.target},${m.hint},${m.bet},'${m.creator}')"` : '';
                    const style = canPlay ? '' : 'background:#555; cursor:default;';
                    
                    c.innerHTML += `<div class="msg-row ${isMe?'me':'other'}">
                        <div class="msg game" style="${style}" ${action}>
                            🎲 ИГРАТЬ<br><small>${status}</small>
                        </div>
                    </div>`;
                } else {
                    c.innerHTML += `<div class="msg-row ${isMe?'me':'other'}">
                        <div class="msg ${isMe?'me':'other'}">${content}</div>
                    </div>`;
                }
            });
            c.scrollTop = c.scrollHeight;
        });
    },
    sendMsg: async () => {
        const txt = document.getElementById('msg-input').value;
        if(!txt && !tempChatImg) return;
        const id = [currentUser.username, curChat].sort().join('_');
        
        // Ensure chat exists
        const cr = doc(db, 'chats', id);
        if(!(await getDoc(cr)).exists()) await setDoc(cr, { created: Date.now() });

        const d = { from: currentUser.username, text: txt, time: Date.now() };
        if(tempChatImg) { d.image = tempChatImg; d.text = '📷 Фото'; }
        await addDoc(collection(db, 'chats', id, 'messages'), d);
        document.getElementById('msg-input').value = ''; tempChatImg = null;
    },
    handleChatImg: (el) => { if(el.files[0]) compress(el.files[0], d => { tempChatImg = d; window.app.sendMsg(); }); },

    // --- GAME LOGIC ---
    createGame: async () => {
        const num = parseInt(document.getElementById('game-number').value);
        const bet = parseInt(document.getElementById('game-bet').value);
        if(currentUser.balance < bet) return alert('Нет денег');
        
        const id = [currentUser.username, curChat].sort().join('_');
        let hint = num + Math.floor(Math.random()*10)-5; 
        
        await updateDoc(doc(db, 'users', currentUser.username), { balance: increment(-bet) });
        await addDoc(collection(db, 'chats', id, 'messages'), { 
            type: 'game_invite', creator: currentUser.username, target: num, hint: hint, bet: bet, time: Date.now(), finished: false 
        });
        window.ui.closeModals();
    },
    startGame: async (mid, cid, target, hint, bet, creator) => {
        if(creator === currentUser.username) return alert('Нельзя играть с самим собой!');
        if(currentUser.balance < bet) return alert('Нет денег');
        
        await updateDoc(doc(db, 'users', currentUser.username), { balance: increment(-bet) });
        
        activeGame = { mid, cid, target, hint, bet, creator };
        document.getElementById('game-ui').classList.remove('hidden');
        document.getElementById('game-hint-num').innerText = hint;
        
        let tl = 100;
        const timerCircle = document.getElementById('timer-progress');
        if(gameTimerInt) clearInterval(gameTimerInt);
        gameTimerInt = setInterval(() => {
            tl -= 1; 
            timerCircle.style.strokeDashoffset = 283 - (tl / 100) * 283;
            if(tl <= 0) { clearInterval(gameTimerInt); window.game.finish(false, 'Время вышло'); }
        }, 100); 
    },
    finishGame: async (isWin, msg) => {
        const winner = isWin ? currentUser.username : activeGame.creator;
        const pot = activeGame.bet * 2;
        
        document.getElementById('game-ui').classList.add('hidden');
        document.getElementById('game-result').classList.remove('hidden');
        document.getElementById('gr-title').innerText = isWin ? "ПОБЕДА" : "ПОРАЖЕНИЕ";
        document.getElementById('gr-msg').innerText = msg;
        
        await updateDoc(doc(db, 'users', winner), { balance: increment(pot) });
        await updateDoc(doc(db, 'chats', activeGame.cid, 'messages', activeGame.mid), { finished: true, winner: winner });
    }
};
// Bind Game functions globally
window.game = {
    openCreate: () => { document.getElementById('game-create-modal').classList.remove('hidden'); },
    create: window.app.createGame,
    start: window.app.startGame,
    makeGuess: window.app.makeGuess,
    finish: window.app.finishGame,
    close: () => { document.getElementById('game-result').classList.add('hidden'); }
};

// --- MARKET & INVENTORY SYSTEM (FIXED) ---
window.market = {
    tab: (t) => {
        const c = document.getElementById('market-content'); c.innerHTML = '';
        document.querySelectorAll('.view#view-market .tab').forEach(e=>e.classList.remove('active'));
        
        const tabs = document.querySelectorAll('.view#view-market .tab');
        if(t==='cases') tabs[0].classList.add('active'); 
        if(t==='market') tabs[1].classList.add('active'); 
        if(t==='inventory') tabs[2].classList.add('active');

        if(t==='cases') {
            c.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:15px; padding:10px;">
                <div class="card" style="display:flex; align-items:center; gap:15px; cursor:pointer;" onclick="window.market.buyCase('normal')">
                    <div style="font-size:40px;">📦</div>
                    <div><b>Обычный Кейс</b><br>100 HC<br><small>Эмодзи (Common-Rare)</small></div>
                </div>
                <div class="card" style="display:flex; align-items:center; gap:15px; border:2px solid orange; cursor:pointer;" onclick="window.market.buyCase('tools')">
                    <div style="font-size:40px;">🛠️</div>
                    <div><b>Tool Box</b><br>250 HC<br><small>Тэгеры, Краска, Палитры</small></div>
                </div>
                <div class="card" style="display:flex; align-items:center; gap:15px; border:2px solid gold; background: linear-gradient(45deg, #000, #333); color:gold; cursor:pointer;" onclick="window.market.buyCase('legacy')">
                    <div style="font-size:40px;">👑</div>
                    <div><b>Legacy Box</b><br>500 HC<br><small>БИЛЕТЫ + Шанс на Мифик</small></div>
                </div>
            </div>`;
        }
        
        if(t==='inventory') {
            if(!currentUser.inventory || currentUser.inventory.length === 0) c.innerHTML = '<div style="text-align:center; padding:20px;">Инвентарь пуст</div>';
            else {
                // Разделяем предметы
                const tools = currentUser.inventory.filter(i => ITEMS_DB.tools.includes(i.emoji));
                const emojis = currentUser.inventory.filter(i => !ITEMS_DB.tools.includes(i.emoji));
                
                if(tools.length > 0) {
                    c.innerHTML += '<h3>Инструменты</h3><div class="market-grid">';
                    tools.forEach(i => {
                        let extra = '';
                        if(i.emoji === '🔫') extra = `<span class="item-qty">${i.charges||0}</span>`;
                        c.innerHTML += `<div class="market-item rarity-${i.rarity}" onclick="window.market.openSell('${i.id}','${i.emoji}','${i.rarity}', ${i.charges||0})">
                            <span style="font-size:40px">${i.emoji}</span>${extra}
                        </div>`;
                    });
                    c.innerHTML += '</div>';
                }
                
                if(emojis.length > 0) {
                    c.innerHTML += '<h3>Эмодзи</h3><div class="market-grid">';
                    emojis.forEach(i => {
                        c.innerHTML += `<div class="market-item rarity-${i.rarity}" onclick="window.market.openSell('${i.id}','${i.emoji}','${i.rarity}')">
                            <span style="font-size:40px">${i.emoji}</span>
                        </div>`;
                    });
                    c.innerHTML += '</div>';
                }
            }
        }
        if(t==='market') window.market.load();
    },

    buyCase: async (type) => {
        const prices = { 'normal': 100, 'tools': 250, 'legacy': 500 };
        const price = prices[type];
        
        if(currentUser.balance < price) return alert('Недостаточно средств!');
        
        // 1. Анимация
        document.getElementById('case-opening-modal').classList.remove('hidden');
        
        // 2. Логика (пока крутится анимация)
        await new Promise(r => setTimeout(r, 1500)); // Ждем 1.5 сек
        
        await updateDoc(doc(db, 'users', currentUser.username), { balance: increment(-price) });
        
        let item = { id: Date.now() + Math.random().toString(), rarity: 'common', emoji: '💩' };
        let isTicket = false;
        let ticketAmount = 0;

        if(type === 'legacy') {
            const rand = Math.random();
            if(rand < 0.90) { 
                // 90% Билеты
                isTicket = true;
                ticketAmount = Math.floor(Math.random() * 5) + 1; // 1-5 билетов
            } else {
                // 10% Мифик
                item.emoji = ITEMS_DB.mythical[Math.floor(Math.random() * ITEMS_DB.mythical.length)];
                item.rarity = 'mythical';
            }
        } else if (type === 'tools') {
            const rand = Math.random();
            if(rand < 0.05) { item.emoji = '🎨'; item.rarity = 'mythical'; } // Палитра
            else if(rand < 0.15) { item.emoji = '🔫'; item.rarity = 'legendary'; item.charges = 1; } // Тэгер
            else if(rand < 0.40) { item.emoji = '🥛'; item.rarity = 'rare'; } // Краска
            else { item.emoji = '🖌️'; item.rarity = 'common'; } // Маркер (заглушка)
        } else {
            // Normal
            item.emoji = ITEMS_DB.emojis[Math.floor(Math.random() * ITEMS_DB.emojis.length)];
        }

        // 3. Сохранение
        if(isTicket) {
            await updateDoc(doc(db, 'users', currentUser.username), { tickets: increment(ticketAmount) });
        } else {
            await updateDoc(doc(db, 'users', currentUser.username), { inventory: arrayUnion(item) });
        }

        // 4. Результат
        document.getElementById('case-opening-modal').classList.add('hidden');
        document.getElementById('drop-result-modal').classList.remove('hidden');
        
        if(isTicket) {
            document.getElementById('drop-icon').innerText = '🎫';
            document.getElementById('drop-name').innerText = `${ticketAmount} Билетов`;
            document.getElementById('drop-rarity').innerText = 'Валюта';
        } else {
            document.getElementById('drop-icon').innerText = item.emoji;
            document.getElementById('drop-name').innerText = item.emoji;
            document.getElementById('drop-rarity').innerText = item.rarity.toUpperCase();
            document.getElementById('drop-rarity').className = `rarity-${item.rarity}`;
        }
        
        currentUser.balance -= price; // Local update
        // Не перекидываем в инвентарь, остаемся тут
    },

    openSell: (id, em, r, ch) => {
        document.getElementById('sell-item-id').value = id;
        document.getElementById('sell-item-emoji').value = em;
        document.getElementById('sell-item-rarity').value = r;
        document.getElementById('sell-item-charges').value = ch || 0;
        document.getElementById('sell-emoji-preview').innerText = em;
        document.getElementById('sell-modal').classList.remove('hidden');
    },

    confirmSell: async () => {
        const p = parseInt(document.getElementById('sell-price').value);
        const id = document.getElementById('sell-item-id').value;
        const em = document.getElementById('sell-item-emoji').value;
        const rar = document.getElementById('sell-item-rarity').value;
        const ch = parseInt(document.getElementById('sell-item-charges').value);
        
        if(!p || p < 0) return alert('Укажите цену');

        // FIX: Находим точный индекс для удаления
        const itemIdx = currentUser.inventory.findIndex(i => i.id === id);
        if(itemIdx === -1) return alert('Ошибка предмета');
        
        // Удаляем локально и в БД
        currentUser.inventory.splice(itemIdx, 1);
        await updateDoc(doc(db, 'users', currentUser.username), { inventory: currentUser.inventory });

        await addDoc(collection(db, 'market_items'), { 
            seller: currentUser.username, 
            emoji: em, rarity: rar, price: p, 
            itemId: id, charges: ch 
        });
        
        alert('Выставлено!');
        window.ui.closeModals(); 
        window.market.tab('inventory');
    },

    load: async () => {
        const c = document.getElementById('market-content'); c.innerHTML='';
        const s = await getDocs(collection(db, 'market_items'));
        if(s.empty) c.innerHTML = '<div style="text-align:center; padding:20px;">Рынок пуст</div>';
        
        s.forEach(d => {
            const i = d.data();
            let extra = '';
            if(i.emoji === '🔫') extra = `<span class="item-qty">${i.charges}</span>`;
            
            c.innerHTML += `<div class="market-item rarity-${i.rarity}" onclick="window.market.buy('${d.id}',${i.price},'${i.emoji}','${i.seller}','${i.rarity}','${i.itemId}', ${i.charges})">
                <span style="font-size:40px">${i.emoji}</span>${extra}<br>
                <b>${i.price} HC</b>
            </div>`;
        });
    },

    buy: async (did, p, em, seller, rar, iid, ch) => {
        document.getElementById('buy-doc-id').value = did;
        document.getElementById('buy-item-price').value = p;
        document.getElementById('buy-emoji-display').innerText = em;
        document.getElementById('buy-seller-display').innerText = seller;
        
        const btn = document.getElementById('buy-btn-action');
        
        if(seller === currentUser.username) {
            btn.innerText = "Снять с продажи"; 
            btn.className = "action-btn btn-danger full-width";
            btn.onclick = () => window.market.cancel(did, em, rar, iid, ch);
        } else {
            btn.innerText = `Купить за ${p} HC`;
            btn.className = "action-btn full-width";
            btn.onclick = () => window.market.execBuy(did, p, em, seller, rar, iid, ch);
        }
        document.getElementById('buy-modal').classList.remove('hidden');
    },

    cancel: async (did, em, rar, iid, ch) => {
        await deleteDoc(doc(db, 'market_items', did));
        const item = { id: iid, emoji: em, rarity: rar };
        if(ch) item.charges = ch;
        
        await updateDoc(doc(db, 'users', currentUser.username), { inventory: arrayUnion(item) });
        // Local update needed to avoid refresh
        currentUser.inventory.push(item);
        
        alert('Снято с продажи'); 
        window.ui.closeModals(); 
        window.market.tab('market');
    },

    execBuy: async (did, p, em, seller, rar, iid, ch) => {
        if(currentUser.balance < p) return alert('Недостаточно средств');
        
        try {
            await runTransaction(db, async (t) => {
                const itemRef = doc(db, 'market_items', did);
                const iDoc = await t.get(itemRef);
                if(!iDoc.exists()) throw "Уже купили!";
                
                t.delete(itemRef);
                t.update(doc(db, 'users', seller), { balance: increment(p) });
                
                const item = { id: iid, emoji: em, rarity: rar };
                if(ch) item.charges = ch;
                
                t.update(doc(db, 'users', currentUser.username), { 
                    balance: increment(-p), 
                    inventory: arrayUnion(item) 
                });
            });
            alert('Куплено!');
            currentUser.balance -= p;
            window.ui.closeModals(); 
            window.market.tab('market');
        } catch(e) {
            alert('Ошибка: ' + e);
        }
    }
};
// --- GRAFFITI SYSTEM ---
window.graffiti = {
    canvas: null,
    ctx: null,
    isPainting: false,
    targetUser: null,
    color: 'black',

    open: (u) => {
        window.graffiti.targetUser = u;
        const modal = document.getElementById('graffiti-modal');
        modal.classList.remove('hidden');
        
        const c = document.getElementById('graffiti-canvas');
        window.graffiti.canvas = c;
        window.graffiti.ctx = c.getContext('2d');
        
        // Reset Canvas
        window.graffiti.clear();
        
        // Check Tools
        const tagger = currentUser.inventory.find(i => i.emoji === '🔫');
        const hasPalette = currentUser.inventory.find(i => i.emoji === '🎨');
        
        document.getElementById('paint-charges').innerText = `(Зарядов: ${tagger.charges || 0})`;
        
        if(hasPalette) {
            document.getElementById('palette-controls').classList.remove('hidden');
        } else {
            document.getElementById('palette-controls').classList.add('hidden');
            window.graffiti.setColor('black');
        }

        // Event Listeners (Mouse & Touch)
        const start = (e) => { window.graffiti.isPainting = true; window.graffiti.draw(e); };
        const stop = () => { window.graffiti.isPainting = false; window.graffiti.ctx.beginPath(); };
        
        c.onmousedown = start;
        c.onmousemove = window.graffiti.draw;
        c.onmouseup = stop;
        
        c.ontouchstart = (e) => { e.preventDefault(); start(e.touches[0]); };
        c.ontouchmove = (e) => { e.preventDefault(); window.graffiti.draw(e.touches[0]); };
        c.ontouchend = stop;
    },

    setColor: (c) => {
        window.graffiti.color = c;
        document.querySelectorAll('.color-swatch').forEach(s => s.style.border = '3px solid white');
        if(c !== 'black') document.querySelector(`.color-swatch.${c}`).style.border = '3px solid gold';
    },

    draw: (e) => {
        if(!window.graffiti.isPainting) return;
        const ctx = window.graffiti.ctx;
        const rect = window.graffiti.canvas.getBoundingClientRect();
        const x = (e.clientX || e.pageX) - rect.left;
        const y = (e.clientY || e.pageY) - rect.top;

        ctx.lineWidth = 5;
        ctx.lineCap = 'round';
        
        if(window.graffiti.color === 'gold') {
            const grad = ctx.createLinearGradient(0, 0, 300, 0);
            grad.addColorStop(0, "#ffd700");
            grad.addColorStop(1, "#b8860b");
            ctx.strokeStyle = grad;
        } else {
            ctx.strokeStyle = window.graffiti.color;
        }

        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x, y);
    },

    clear: () => {
        window.graffiti.ctx.clearRect(0, 0, 300, 150);
    },

    save: async () => {
        const taggerIdx = currentUser.inventory.findIndex(i => i.emoji === '🔫');
        if(taggerIdx === -1 || currentUser.inventory[taggerIdx].charges < 1) return alert('Нет зарядов! Найдите краску 🥛');

        const imgData = window.graffiti.canvas.toDataURL();
        
        // Save to Target Profile
        await updateDoc(doc(db, 'users', window.graffiti.targetUser), {
            graffiti: { author: currentUser.username, img: imgData, time: Date.now() }
        });
        
        // Deduct Charge
        currentUser.inventory[taggerIdx].charges--;
        await updateDoc(doc(db, 'users', currentUser.username), { inventory: currentUser.inventory });
        
        alert('Затэгано!');
        window.ui.closeModals();
        window.app.loadProfile(window.graffiti.targetUser);
    }
};

// --- DECOR SHOP (TICKETS) ---
window.decor = {
    items: [
        { id: 'bg_space', type: 'bg', name: 'Космос', price: 1, url: 'https://i.imgur.com/M8P5c8z.jpeg' },
        { id: 'bg_city', type: 'bg', name: 'Киберпанк', price: 2, url: 'https://i.imgur.com/u7y7qgP.jpeg' },
        { id: 'fx_snow', type: 'fx', name: 'Снег', price: 1, url: 'https://i.imgur.com/8Q5q5qP.png' }, // Transparent PNG needed
        { id: 'fx_money', type: 'fx', name: 'Деньги', price: 3, url: 'https://i.imgur.com/abc.png' }
    ],
    
    openShop: () => {
        document.getElementById('decor-shop-modal').classList.remove('hidden');
        document.getElementById('shop-tickets-display').innerText = currentUser.tickets || 0;
        window.decor.tab('bg');
    },

    tab: (t) => {
        const c = document.getElementById('decor-shop-list'); c.innerHTML = '';
        const list = window.decor.items.filter(i => i.type === t);
        
        list.forEach(i => {
            c.innerHTML += `<div class="market-item" onclick="window.decor.buy('${i.id}')">
                <div style="width:100%; height:50px; background:url('${i.url}') center/cover; border-radius:5px;"></div>
                <b>${i.name}</b><br>
                🎫 ${i.price}
            </div>`;
        });
    },

    buy: async (itemId) => {
        const item = window.decor.items.find(i => i.id === itemId);
        if((currentUser.tickets || 0) < item.price) return alert('Не хватает билетов!');
        
        if(!confirm(`Купить "${item.name}" за ${item.price} 🎫? Это установит фон в текущем чате.`)) return;

        // Pay
        await updateDoc(doc(db, 'users', currentUser.username), { tickets: increment(-item.price) });
        currentUser.tickets -= item.price;
        document.getElementById('shop-tickets-display').innerText = currentUser.tickets;

        // Set Decor in Chat
        const id = [currentUser.username, curChat].sort().join('_');
        const upd = {};
        upd[item.type] = item.url; // bg or fx
        
        await setDoc(doc(db, 'chats', id), upd, { merge: true });
        
        alert('Установлено!');
        window.ui.closeModals();
        window.app.loadChatRoom(curChat);
    }
};

// --- ADMIN PANEL ---
window.admin = {
    tab: (t) => {
        const c = document.getElementById('adm-content'); c.innerHTML='';
        document.querySelectorAll('.view#view-admin .tab').forEach(e=>e.classList.remove('active'));
        
        if(t==='users') {
            c.innerHTML = '<input class="search-bar" oninput="window.admin.search(this.value)" placeholder="Поиск юзера..."> <div id="adm-list"></div>';
        }
        if(t==='mod') window.admin.loadModQueue();
        if(t==='verify') window.admin.loadV();
    },

    search: async (v) => {
        if(!v) return;
        const s = await getDocs(query(collection(db, 'users'), where('username', '>=', v.toLowerCase()), limit(5)));
        const c = document.getElementById('adm-list'); c.innerHTML='';
        
        s.forEach(d => {
            const u = d.data();
            c.innerHTML += `<div class="card">
                <b>${u.username}</b> (Bal: ${u.balance})
                <br>
                <div style="display:flex; gap:5px; flex-wrap:wrap; margin-top:5px;">
                    <button class="action-btn btn-danger sm-btn" onclick="window.admin.ban('${u.username}')">${u.isBanned?'РАЗБАН':'БАН'}</button>
                    <button class="action-btn btn-gold sm-btn" onclick="window.admin.toggleAdmin('${u.username}', ${u.isAdmin})">${u.isAdmin?'Снять Адм':'Дать Адм'}</button>
                    <button class="action-btn sm-btn" onclick="window.admin.warn('${u.username}')">WARN</button>
                    <button class="action-btn btn-danger sm-btn" onclick="window.admin.delAcc('${u.username}')">УДАЛИТЬ</button>
                </div>
            </div>`;
        });
    },

    ban: async (u) => { const curr = (await getDoc(doc(db,'users',u))).data().isBanned; await updateDoc(doc(db,'users',u), {isBanned:!curr}); alert('Готово'); },
    warn: async (u) => { const r = prompt('Причина?'); if(r) { window.app.notify(u, 'warn', 'WARN: '+r); alert('Отправлено'); } },
    toggleAdmin: async (u, curr) => { await updateDoc(doc(db,'users',u), {isAdmin:!curr}); alert('Права изменены'); },
    delAcc: async (u) => { if(confirm('Удалить навсегда?')) { await deleteDoc(doc(db,'users',u)); alert('Удален'); } },
    
    loadModQueue: async () => {
        const s = await getDocs(query(collection(db,'posts'), where('approved','==',false)));
        const c = document.getElementById('adm-content'); c.innerHTML='';
        if(s.empty) c.innerHTML='<p>Чисто.</p>';
        
        s.forEach(d => {
            const p = d.data();
            c.innerHTML += `<div class="card" style="border:2px solid orange">
                <b>${p.author}</b><br>${p.content}<br>
                ${p.image ? '[ФОТО]' : ''} ${p.actionBtn ? '[КНОПКА]' : ''}
                <div style="margin-top:10px;">
                    <button class="action-btn sm-btn" onclick="window.admin.approve('${d.id}')">OK</button>
                    <button class="action-btn btn-danger sm-btn" onclick="window.admin.reject('${d.id}')">NO</button>
                </div>
            </div>`;
        });
    },
    
    approve: async (id) => { await updateDoc(doc(db,'posts',id), {approved:true}); window.admin.loadModQueue(); },
    reject: async (id) => { await deleteDoc(doc(db,'posts',id)); window.admin.loadModQueue(); },
    
    loadV: async () => {
        const s = await getDocs(query(collection(db,'system','verifications','requests'), where('status','==','pending')));
        const c = document.getElementById('adm-content'); c.innerHTML='';
        if(s.empty) c.innerHTML='<p>Нет заявок.</p>';
        
        s.forEach(d => {
            const r = d.data();
            c.innerHTML += `<div class="card">
                <b>${r.username}</b>: ${r.realname} (${r.reason})
                <button class="action-btn sm-btn" onclick="window.admin.okV('${d.id}','${r.username}')">ДА</button>
                <button class="action-btn btn-danger sm-btn" onclick="window.admin.noV('${d.id}')">НЕТ</button>
            </div>`;
        });
    },
    
    okV: async (id, u) => { await updateDoc(doc(db,'users',u), {isVerified:true}); await updateDoc(doc(db,'system','verifications','requests',id), {status:'ok'}); window.admin.loadV(); },
    noV: async (id) => { await updateDoc(doc(db,'system','verifications','requests',id), {status:'no'}); window.admin.loadV(); }
};

// Init App
window.app.init();
