import { migrate } from './db';
import { Users, Rel, Friends, Fragments, Cards, now } from './repo';

migrate();

// デモユーザー（spec のデモアカウント @maruyama / 丸山）
const DEMO = {
  id: 'u_maruyama',
  user_id: 'maruyama',
  display_name: '丸山',
  bio: 'だいたい一番後ろの席にいる。旅と、その帰り道が好き。',
  avatar: '丸',
  profile_private: 1,
};

Users.upsert(DEMO);
Rel.get(DEMO.id); // 初期化

// 受信中のともだち申請（最小UI検証用。spec: 灯里からの申請）
if (Friends.incoming(DEMO.id).length === 0) {
  Friends.add(DEMO.id, 'u_akari', '灯里');
}

console.log('✓ seeded demo user @maruyama (u_maruyama)');
