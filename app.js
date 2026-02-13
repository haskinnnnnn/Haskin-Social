import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, doc, setDoc, getDoc, updateDoc, deleteDoc, arrayUnion, arrayRemove, onSnapshot, query, orderBy, where, limit, increment, runTransaction } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

// --- ВСТАВЬ СВОЙ КОНФИГ ---
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

const compress = (file, cb) => {
    const r = new FileReader(); r.readAsDataURL(file);
    r.onload = e => { const i = new Image(); i.src = e.target.result; i.onload = () => { const c = document.createElement('canvas'); const max = 800; let w=i.width, h=i.height; if(w>h){if(w>max){h*=max/w;w=max}}else{if(h>max){w*=max/h;h=max}} c.width=w; c.height=h; c.getContext('2d').drawImage(i,0,0,w,h); cb(c.toDataURL('image/jpeg', 0.8)); } }
};

const getAv = (u, sz, addFrame=false) => {
    if(!u) return '';
    let src = u.avatar || u.authorAvatar || 'https://via.placeholder.com/80';
    let frameClass = '', satellites = '';
    const inv = u.inventory || u.authorInventory || [];
    const pins = u.pinnedEmojis || {};
    if(addFrame && inv.length > 0) { if(inv.some(i => i.rarity === 'legendary')) frameClass = 'frame-legendary'; }
    if(pins.slot1) satellites += `<span class="sat-icon sat-1">${pins.slot1}</span>`;
    if(pins.slot2) satellites += `<span class="sat-icon sat-2">${pins.slot2}</span>`;
    return `<div class="avatar-wrap"><img src="${src}" class="avatar ${sz} ${frameClass}">${satellites}</div>`;
};

const parseTime = ts => new Date(ts).toLocaleDateString();

// --- UI ---
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
        
        const map = {'feed':0, 'market':1, 'search':2, 'groups':3, 'chats':4, 'notifs':5, 'rich':6, 'profile':7, 'settings':8};
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
        if(v==='settings' && currentUser.isAdmin) document.getElementById('settings-admin-btn').classList.remove('hidden');
    },
    closeModals: () => {
        document.querySelectorAll('.modal-overlay').forEach(e => e.classList.add('hidden'));
        document.getElementById('case-result').classList.add('hidden');
        document.getElementById('case-spinner').classList.remove('hidden');
        document.getElementById('case-close-btn').classList.add('hidden');
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
        document.body.style.background = d ? '#0f0f0f' : '#fff';
        document.body.style.color = d ? '#fff' : '#000';
    }
};

// --- APP ---
window.app = {
    init: async () => {
        const u = localStorage.getItem('user');
        if(u) {
            const s = await getDoc(doc(db, 'users', u));
            if(s.exists()) {
                currentUser = s.data();
                // FIXES
                let fix = {};
                if(!currentUser.inventory) fix.inventory = [];
                if(!currentUser.pinnedEmojis) fix.pinnedEmojis = {};
                if(!currentUser.balance) fix.balance = 0;
                if(Object.keys(fix).length > 0) { await updateDoc(doc(db, 'users', u), fix); currentUser = {...currentUser, ...fix}; }
                
                if(currentUser.isBanned) return alert('BANNED');
                
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
        } else alert('Error');
    },
    register: async () => {
        const u = document.getElementById('reg-user').value.toLowerCase().trim();
        const n = document.getElementById('reg-name').value;
        const p = document.getElementById('reg-pass').value;
        await setDoc(doc(db, 'users', u), { username: u, name: n, password: p, balance: 10, inventory: [], pinnedEmojis: {}, followers:[], following:[], blocked:[], isAdmin:false, createdAt: Date.now() });
        alert('Created'); window.ui.toggleAuth('login');
    },
    logout: () => { localStorage.clear(); location.reload(); },
    
    // POSTS
    openCreatePost: () => { document.getElementById('create-post-modal').classList.remove('hidden'); },
    handleImg: (el) => { if(el.files[0]) compress(el.files[0], d => { tempImg = d; document.getElementById('preview-img-el').src=d; document.getElementById('post-img-preview').classList.remove('hidden'); }); },
    clearImg: () => { tempImg = null; document.getElementById('post-img-preview').classList.add('hidden'); },
    createPost: async () => {
        const txt = document.getElementById('post-text').value;
        const btnText = document.getElementById('post-btn-text').value;
        const btnLink = document.getElementById('post-btn-link').value;
        
        if(!txt && !tempImg) return;
        
        // AUTO MODERATION: If link or image, send to mod queue
        const needsMod = (tempImg || btnLink) ? true : false;
        
        await addDoc(collection(db, 'posts'), {
            author: currentUser.username, name: currentUser.name, content: txt, image: tempImg, 
            actionBtn: (btnText && btnLink) ? {text: btnText, link: btnLink} : null,
            likes: [], createdAt: Date.now(),
            approved: !needsMod,
            authorInventory: currentUser.inventory, pinnedEmojis: currentUser.pinnedEmojis,
            groupId: activeGroupId
        });
        
        if(needsMod) alert('Отправлено на модерацию');
        else alert('Опубликовано');
        
        document.getElementById('post-text').value = ''; window.app.clearImg(); window.ui.closeModals();
        if(activeGroupId) window.app.loadProfile(activeGroupId);
    },
    loadFeed: () => {
        if(listeners.feed) listeners.feed();
        const q = query(collection(db, 'posts'), orderBy('createdAt', 'desc'), limit(30));
        listeners.feed = onSnapshot(q, s => {
            let html = '';
            s.forEach(d => {
                const p = d.data(); p.id = d.id;
                if(!p.approved && p.author !== currentUser.username && !currentUser.isAdmin) return;
                if(p.groupId) return;
                if(currentUser.blocked && currentUser.blocked.includes(p.author)) return;
                html += window.app.renderPost(p);
            });
            document.getElementById('feed-content').innerHTML = html;
        });
    },
    renderPost: (p) => {
        const fakeUser = { avatar: p.avatar, authorAvatar: p.authorAvatar, inventory: p.authorInventory, pinnedEmojis: p.pinnedEmojis };
        // ACTION BUTTON RENDER
        const actionBtnHtml = p.actionBtn ? `<a href="${p.actionBtn.link}" target="_blank" class="action-btn-link">${p.actionBtn.text}</a>` : '';
        
        return `<div class="card">
            <div class="user-row" onclick="window.ui.nav('profile','${p.author}')">
                ${getAv(fakeUser, 'av-40', true)}
                <div><b>${p.name}</b> ${p.verified?ICONS.verify:''}<br><small>${parseTime(p.createdAt)} ${!p.approved?'[MOD]':''}</small></div>
            </div>
            <div style="margin:10px 0; white-space:pre-wrap;">${p.content}</div>
            ${p.image ? `<img src="${p.image}" class="post-img">` : ''}
            ${actionBtnHtml}
            <div class="user-row" style="margin-top:10px; justify-content:space-between;">
                <button class="action-btn btn-sec" onclick="window.app.like('${p.id}', '${p.author}')">❤️ ${p.likes?.length||0}</button>
                <button class="action-btn btn-sec" onclick="window.app.openComs('${p.id}')">💬</button>
                ${currentUser.isAdmin || p.author===currentUser.username ? `<button class="action-btn btn-danger sm-btn" onclick="window.app.delPost('${p.id}')">Del</button>` : ''}
            </div>
        </div>`;
    },
    
    // PROFILE
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
            
            c.innerHTML = `<div class="card center-content">
                ${getAv(user, 'av-80', true)}
                <h2>${user.name} ${user.isVerified?ICONS.verify:''}</h2>
                <div style="color:gray">@${user.username}</div>
                <div style="display:flex; justify-content:center; gap:20px; margin:10px;">
                    <b>${user.followers?.length||0} подп.</b>
                    <b>${user.following?.length||0} подписки</b>
                </div>
                ${isMe ? `<button class="action-btn sm-btn" onclick="window.ui.nav('settings')">Ред.</button>` : 
                  (isBlocked ? `<button class="action-btn btn-sec" onclick="window.app.block('${u}', false)">Разблокировать</button>` :
                  `<button class="action-btn sm-btn" onclick="window.app.follow('${u}')">${isFollow?'Отписаться':'Подписаться'}</button> 
                   <button class="action-btn sm-btn btn-sec" onclick="window.ui.nav('chat-room','${u}')">Чат</button>
                   <button class="action-btn sm-btn btn-danger" onclick="window.app.block('${u}', true)">Блок</button>`)}
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
                const isOwner = group.owner === currentUser.username;
                c.innerHTML = `<div class="card center-content"><h2>${group.name}</h2><p>${group.desc}</p>
                <button class="action-btn" onclick="window.app.openCreatePost()">Пост</button>
                ${isOwner ? `<button class="action-btn btn-sec sm-btn" onclick="window.app.editGroup('${u}')">Ред</button>` : ''}
                </div>`;
                const q = query(collection(db, 'posts'), where('groupId', '==', u));
                const ps = await getDocs(q);
                ps.forEach(d => pc.innerHTML += window.app.renderPost({...d.data(), id:d.id}));
            }
        }
    },
    
    // ACTIONS
    like: async (id, auth) => {
        const r = doc(db, 'posts', id);
        const p = (await getDoc(r)).data();
        if(p.likes.includes(currentUser.username)) await updateDoc(r, {likes: arrayRemove(currentUser.username)});
        else { await updateDoc(r, {likes: arrayUnion(currentUser.username)}); window.app.notify(auth, 'like', 'Лайк'); }
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
            window.app.notify(u, 'sub', 'Подписался');
        }
        window.app.loadProfile(u);
    },
    block: async (u, doBlock) => {
        const me = doc(db, 'users', currentUser.username);
        if(doBlock) { await updateDoc(me, {blocked: arrayUnion(u)}); if(!currentUser.blocked) currentUser.blocked=[]; currentUser.blocked.push(u); }
        else { await updateDoc(me, {blocked: arrayRemove(u)}); currentUser.blocked = currentUser.blocked.filter(x=>x!==u); }
        window.app.loadProfile(u);
    },
    delPost: async (id) => { if(confirm('Del?')) await deleteDoc(doc(db, 'posts', id)); window.ui.nav('feed'); },
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
                    c.innerHTML += `<div class="msg-row ${isMe?'me':'other'}"><div class="msg game" onclick="window.game.start('${d.id}','${id}',${m.target},${m.hint},${m.bet},'${m.creator}')">🎮 ИГРАТЬ (${m.bet} HC)<br>${m.finished ? 'Завершено':''}</div></div>`;
                } else {
                    c.innerHTML += `<div class="msg-row ${isMe?'me':'other'}"><div class="msg ${isMe?'me':'other'}">${content}</div></div>`;
                }
            });
            c.scrollTop = c.scrollHeight;
        });
    },
    sendMsg: async () => {
        const txt = document.getElementById('msg-input').value;
        if(!txt && !tempChatImg) return;
        const id = [currentUser.username, curChat].sort().join('_');
        const d = { from: currentUser.username, text: txt, time: Date.now() };
        if(tempChatImg) { d.image = tempChatImg; d.text = '📷 Фото'; }
        await addDoc(collection(db, 'chats', id, 'messages'), d);
        document.getElementById('msg-input').value = ''; tempChatImg = null;
    },
    handleChatImg: (el) => { if(el.files[0]) compress(el.files[0], d => { tempChatImg = d; window.app.sendMsg(); }); },
    loadRich: async () => {
        const c = document.getElementById('rich-list'); c.innerHTML = '';
        const s = await getDocs(query(collection(db, 'users'), orderBy('balance', 'desc'), limit(10)));
        let i = 1;
        s.forEach(d => {
            const u = d.data();
            if(u.username === 'haskin') return;
            c.innerHTML += `<div class="card user-row" onclick="window.ui.nav('profile','${u.username}')"><b>#${i++}</b> ${getAv(u,'av-40')} <div><b>${u.name}</b><br>${u.balance} HC</div></div>`;
        });
    },
    createGroup: async () => {
        const n = document.getElementById('group-name').value;
        const id = 'g_'+Date.now();
        await setDoc(doc(db,'groups',id), { id, name: n, desc: document.getElementById('group-desc').value, owner: currentUser.username, members:[currentUser.username] });
        window.ui.closeModals(); window.ui.nav('groups');
    },
    loadGroups: async () => {
        const c = document.getElementById('groups-list'); c.innerHTML='';
        const s = await getDocs(query(collection(db,'groups'), limit(20)));
        s.forEach(d => c.innerHTML += `<div class="card" onclick="window.ui.nav('profile','${d.id}')"><b>${d.data().name}</b></div>`);
    },
    editGroup: async (gid) => { 
        const g = (await getDoc(doc(db,'groups',gid))).data(); 
        document.getElementById('edit-group-name').value=g.name; 
        document.getElementById('edit-group-desc').value=g.desc; 
        document.getElementById('edit-group-id').value=gid; 
        document.getElementById('edit-group-modal').classList.remove('hidden');
    },
    saveGroupChanges: async () => {
        const gid = document.getElementById('edit-group-id').value;
        const upd = { name: document.getElementById('edit-group-name').value, desc: document.getElementById('edit-group-desc').value };
        if(tempAv) upd.avatar = tempAv;
        await updateDoc(doc(db,'groups',gid), upd);
        window.ui.closeModals(); window.app.loadProfile(gid);
    },
    handleAvatar: (el, isGroup) => { if(el.files[0]) compress(el.files[0], d => { tempAv = d; if(isGroup) document.getElementById('edit-group-av-prev').src=d; }); },
    saveProfile: async () => {
    
