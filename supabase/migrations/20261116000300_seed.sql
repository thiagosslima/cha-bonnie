-- =====================================================================
-- Dados iniciais (todos editáveis no painel /admin)
-- =====================================================================

insert into public.events (slug, city, state, event_date, event_time, venue, venue_detail, address_line1, address_line2,
                           maps_url, theme_primary, theme_soft, heart_emoji, welcome_message, msg_confirmed, msg_maybe, msg_declined,
                           expected_guests, sort_order)
values
(
  'indaiatuba', 'Indaiatuba', 'SP', '2026-11-28', '15:00',
  'Salão de festas', 'Cond. Res. Solar dos Girassóis',
  'Rua Christiano Seleguin, 530', 'Parque Res. Indaiá, Indaiatuba, SP',
  'https://www.google.com/maps/search/?api=1&query=Rua%20Christiano%20Seleguin%2C%20530%2C%20Parque%20Residencial%20Indai%C3%A1%2C%20Indaiatuba%20-%20SP',
  '#E36192', '#FDF5F8', '💖',
  'Estamos muito felizes e ansiosos com a chegada da nossa princesa. E convidamos você para comemorar com a gente esse momento tão especial!',
  E'Que alegria! 💖\n\nEstamos muito felizes que você estará com a gente nesse momento tão especial.\n\nMal podemos esperar para celebrar a chegada da nossa Bonnie com você!',
  E'Sem problemas! 💖\n\nEsperamos que você consiga estar com a gente para celebrar esse momento tão especial.\n\nQuando souber, é só voltar aqui para atualizar sua resposta!',
  E'Vamos sentir sua falta! 💖\n\nMas ficamos muito felizes por você fazer parte da nossa história e compartilhar desse momento tão especial.',
  80, 1
),
(
  'guarulhos', 'Guarulhos', 'SP', '2026-12-05', '16:00',
  'Salão de festas', 'Cidade Maia',
  'Avenida Bartolomeu de Carlos, 901', 'Jardim Flor da Montanha, Guarulhos, SP',
  'https://www.google.com/maps/search/?api=1&query=Avenida%20Bartolomeu%20de%20Carlos%2C%20901%2C%20Jardim%20Flor%20da%20Montanha%2C%20Guarulhos%20-%20SP',
  '#C0A4ED', '#F8F5FA', '💜',
  'Estamos muito felizes e ansiosos com a chegada da nossa princesa. E convidamos você para comemorar com a gente esse momento tão especial!',
  E'Que alegria! 💜\n\nEstamos muito felizes que você estará com a gente nesse momento tão especial.\n\nMal podemos esperar para celebrar a chegada da nossa Bonnie com você!',
  E'Sem problemas! 💜\n\nEsperamos que você consiga estar com a gente para celebrar esse momento tão especial.\n\nQuando souber, é só voltar aqui para atualizar sua resposta!',
  E'Vamos sentir sua falta! 💜\n\nMas ficamos muito felizes por você fazer parte da nossa história e compartilhar desse momento tão especial.',
  50, 2
);

insert into public.diaper_targets (event_id, diaper_size, target_percentage)
select e.id, t.size::public.diaper_size, t.pct
from public.events e
cross join (values ('RN', 5), ('P', 15), ('M', 35), ('G', 30), ('XG', 15)) as t(size, pct);

insert into public.gift_recommendation_settings (id) values (1);
