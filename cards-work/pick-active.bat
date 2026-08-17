@echo off
chcp 65001 >nul
rem 활성 카드 100장만 골라냅니다. Storage 에는 예전 카드까지 125장이 있는데,
rem 그중 지금 쓰이는 것만 올려야 필요 없는 파일이 늘지 않습니다.
cd /d C:\develop\MEMONS\cards-work
if exist upload rd /s /q upload
mkdir upload
mkdir upload\common
mkdir upload\epic
mkdir upload\legendary
mkdir upload\mythic
mkdir upload\rare
mkdir upload\special
copy /y "webp\common\common_mrh1job2q55.webp" "upload\common\common_mrh1job2q55.webp" >nul
copy /y "webp\common\common_mrh1jogo6p4.webp" "upload\common\common_mrh1jogo6p4.webp" >nul
copy /y "webp\common\common_mrh1jon76u0.webp" "upload\common\common_mrh1jon76u0.webp" >nul
copy /y "webp\common\common_mrh1joufeyo.webp" "upload\common\common_mrh1joufeyo.webp" >nul
copy /y "webp\common\common_mrh1jp1fn3x.webp" "upload\common\common_mrh1jp1fn3x.webp" >nul
copy /y "webp\common\common_mrh1jp8r5u3.webp" "upload\common\common_mrh1jp8r5u3.webp" >nul
copy /y "webp\common\common_mrh1jpexawq.webp" "upload\common\common_mrh1jpexawq.webp" >nul
copy /y "webp\common\common_mrh1jpsjcex.webp" "upload\common\common_mrh1jpsjcex.webp" >nul
copy /y "webp\common\common_mrh1jpyq3jr.webp" "upload\common\common_mrh1jpyq3jr.webp" >nul
copy /y "webp\common\common_mrh1jq4gta2.webp" "upload\common\common_mrh1jq4gta2.webp" >nul
copy /y "webp\common\common_mrh1jq9z5j0.webp" "upload\common\common_mrh1jq9z5j0.webp" >nul
copy /y "webp\common\common_mrh1jqh8pqo.webp" "upload\common\common_mrh1jqh8pqo.webp" >nul
copy /y "webp\common\common_mrh1jqpfy87.webp" "upload\common\common_mrh1jqpfy87.webp" >nul
copy /y "webp\common\common_mrh1jqv8ion.webp" "upload\common\common_mrh1jqv8ion.webp" >nul
copy /y "webp\common\common_mrh1jr1178u.webp" "upload\common\common_mrh1jr1178u.webp" >nul
copy /y "webp\common\common_mrh1jr6nm3b.webp" "upload\common\common_mrh1jr6nm3b.webp" >nul
copy /y "webp\common\common_mrh1jrc0kw9.webp" "upload\common\common_mrh1jrc0kw9.webp" >nul
copy /y "webp\common\common_mrh1jro3ow1.webp" "upload\common\common_mrh1jro3ow1.webp" >nul
copy /y "webp\common\common_mrh1jru4ri0.webp" "upload\common\common_mrh1jru4ri0.webp" >nul
copy /y "webp\common\common_mrh1js01k94.webp" "upload\common\common_mrh1js01k94.webp" >nul
copy /y "webp\common\common_mrh1jscd9np.webp" "upload\common\common_mrh1jscd9np.webp" >nul
copy /y "webp\common\common_mrh1jsijmdu.webp" "upload\common\common_mrh1jsijmdu.webp" >nul
copy /y "webp\common\common_mrh1jsognxj.webp" "upload\common\common_mrh1jsognxj.webp" >nul
copy /y "webp\common\common_mrh1jsv6xok.webp" "upload\common\common_mrh1jsv6xok.webp" >nul
copy /y "webp\common\common_mrh1jt3n3pu.webp" "upload\common\common_mrh1jt3n3pu.webp" >nul
copy /y "webp\common\common_mrh1jta6olz.webp" "upload\common\common_mrh1jta6olz.webp" >nul
copy /y "webp\common\common_mrh1jtfj487.webp" "upload\common\common_mrh1jtfj487.webp" >nul
copy /y "webp\common\common_mrh1jtlzlgq.webp" "upload\common\common_mrh1jtlzlgq.webp" >nul
copy /y "webp\common\common_mrh1jtqw47a.webp" "upload\common\common_mrh1jtqw47a.webp" >nul
copy /y "webp\common\common_mrh1jtxeizq.webp" "upload\common\common_mrh1jtxeizq.webp" >nul
copy /y "webp\common\common_mrh1ju41bnu.webp" "upload\common\common_mrh1ju41bnu.webp" >nul
copy /y "webp\common\common_mrh1ju9et9r.webp" "upload\common\common_mrh1ju9et9r.webp" >nul
copy /y "webp\common\common_mrh1juesuu9.webp" "upload\common\common_mrh1juesuu9.webp" >nul
copy /y "webp\common\common_mrh1jul66ai.webp" "upload\common\common_mrh1jul66ai.webp" >nul
copy /y "webp\common\common_mrh1juq6ohe.webp" "upload\common\common_mrh1juq6ohe.webp" >nul
copy /y "webp\common\common_mrh1juvs4tb.webp" "upload\common\common_mrh1juvs4tb.webp" >nul
copy /y "webp\common\common_mrh1jv1o5pg.webp" "upload\common\common_mrh1jv1o5pg.webp" >nul
copy /y "webp\common\common_mrh1jvb6752.webp" "upload\common\common_mrh1jvb6752.webp" >nul
copy /y "webp\common\common_mrh1jvhf2ej.webp" "upload\common\common_mrh1jvhf2ej.webp" >nul
copy /y "webp\common\common_mrh1k6de3bv.webp" "upload\common\common_mrh1k6de3bv.webp" >nul
copy /y "webp\epic\epic_mrh1kyc9y66.webp" "upload\epic\epic_mrh1kyc9y66.webp" >nul
copy /y "webp\epic\epic_mrh1kyjang5.webp" "upload\epic\epic_mrh1kyjang5.webp" >nul
copy /y "webp\epic\epic_mrh1kyt3kz9.webp" "upload\epic\epic_mrh1kyt3kz9.webp" >nul
copy /y "webp\epic\epic_mrh1kz1as0s.webp" "upload\epic\epic_mrh1kz1as0s.webp" >nul
copy /y "webp\epic\epic_mrh1kzalzcw.webp" "upload\epic\epic_mrh1kzalzcw.webp" >nul
copy /y "webp\epic\epic_mrh1kzkk78z.webp" "upload\epic\epic_mrh1kzkk78z.webp" >nul
copy /y "webp\epic\epic_mrh1kzv7vyi.webp" "upload\epic\epic_mrh1kzv7vyi.webp" >nul
copy /y "webp\epic\epic_mrh1l02at5b.webp" "upload\epic\epic_mrh1l02at5b.webp" >nul
copy /y "webp\epic\epic_mrh1l09gp8g.webp" "upload\epic\epic_mrh1l09gp8g.webp" >nul
copy /y "webp\epic\epic_mrh1l0iyuy5.webp" "upload\epic\epic_mrh1l0iyuy5.webp" >nul
copy /y "webp\epic\epic_mrh1l0pojo1.webp" "upload\epic\epic_mrh1l0pojo1.webp" >nul
copy /y "webp\epic\epic_mrh1l0ydiix.webp" "upload\epic\epic_mrh1l0ydiix.webp" >nul
copy /y "webp\epic\epic_mrh1l16ngl4.webp" "upload\epic\epic_mrh1l16ngl4.webp" >nul
copy /y "webp\epic\epic_mrh1l1gg7kc.webp" "upload\epic\epic_mrh1l1gg7kc.webp" >nul
copy /y "webp\epic\epic_mrh1l1nfrd6.webp" "upload\epic\epic_mrh1l1nfrd6.webp" >nul
copy /y "webp\legendary\legendary_mrh1n4xztgt.webp" "upload\legendary\legendary_mrh1n4xztgt.webp" >nul
copy /y "webp\legendary\legendary_mrh1n54zch8.webp" "upload\legendary\legendary_mrh1n54zch8.webp" >nul
copy /y "webp\legendary\legendary_mrh1n5hz0mq.webp" "upload\legendary\legendary_mrh1n5hz0mq.webp" >nul
copy /y "webp\legendary\legendary_mrh1n5pmxq2.webp" "upload\legendary\legendary_mrh1n5pmxq2.webp" >nul
copy /y "webp\legendary\legendary_mrh1n5vyt0s.webp" "upload\legendary\legendary_mrh1n5vyt0s.webp" >nul
copy /y "webp\legendary\legendary_mrh1n623dgk.webp" "upload\legendary\legendary_mrh1n623dgk.webp" >nul
copy /y "webp\legendary\legendary_mrh1n67lyjf.webp" "upload\legendary\legendary_mrh1n67lyjf.webp" >nul
copy /y "webp\legendary\legendary_mrh1n6gclyh.webp" "upload\legendary\legendary_mrh1n6gclyh.webp" >nul
copy /y "webp\legendary\legendary_mrh1n6pxujm.webp" "upload\legendary\legendary_mrh1n6pxujm.webp" >nul
copy /y "webp\legendary\legendary_mrh1nb8x4b3.webp" "upload\legendary\legendary_mrh1nb8x4b3.webp" >nul
copy /y "webp\mythic\mythic_ms5riukaa8b.webp" "upload\mythic\mythic_ms5riukaa8b.webp" >nul
copy /y "webp\mythic\mythic_ms5riwt2tqo.webp" "upload\mythic\mythic_ms5riwt2tqo.webp" >nul
copy /y "webp\mythic\mythic_ms5riz82guj.webp" "upload\mythic\mythic_ms5riz82guj.webp" >nul
copy /y "webp\mythic\mythic_ms5rj187dn4.webp" "upload\mythic\mythic_ms5rj187dn4.webp" >nul
copy /y "webp\mythic\mythic_ms5rj2tgj61.webp" "upload\mythic\mythic_ms5rj2tgj61.webp" >nul
copy /y "webp\rare\rare_mrn95pmfnye.webp" "upload\rare\rare_mrn95pmfnye.webp" >nul
copy /y "webp\rare\rare_mrn95pt7v1q.webp" "upload\rare\rare_mrn95pt7v1q.webp" >nul
copy /y "webp\rare\rare_mrn95q084m1.webp" "upload\rare\rare_mrn95q084m1.webp" >nul
copy /y "webp\rare\rare_mrn95qki7lv.webp" "upload\rare\rare_mrn95qki7lv.webp" >nul
copy /y "webp\rare\rare_mrn95qq47j9.webp" "upload\rare\rare_mrn95qq47j9.webp" >nul
copy /y "webp\rare\rare_mrn96opd79y.webp" "upload\rare\rare_mrn96opd79y.webp" >nul
copy /y "webp\rare\rare_mrn96p27kdf.webp" "upload\rare\rare_mrn96p27kdf.webp" >nul
copy /y "webp\rare\rare_mrn96p8q99f.webp" "upload\rare\rare_mrn96p8q99f.webp" >nul
copy /y "webp\rare\rare_mrn96phc8m2.webp" "upload\rare\rare_mrn96phc8m2.webp" >nul
copy /y "webp\rare\rare_mrn96ptt794.webp" "upload\rare\rare_mrn96ptt794.webp" >nul
copy /y "webp\rare\rare_mrn9702b1dj.webp" "upload\rare\rare_mrn9702b1dj.webp" >nul
copy /y "webp\rare\rare_mrn970eu2e4.webp" "upload\rare\rare_mrn970eu2e4.webp" >nul
copy /y "webp\rare\rare_mrn970uzf89.webp" "upload\rare\rare_mrn970uzf89.webp" >nul
copy /y "webp\rare\rare_mrn9712jo9d.webp" "upload\rare\rare_mrn9712jo9d.webp" >nul
copy /y "webp\rare\rare_mrn971gexeg.webp" "upload\rare\rare_mrn971gexeg.webp" >nul
copy /y "webp\rare\rare_mrn971lyndg.webp" "upload\rare\rare_mrn971lyndg.webp" >nul
copy /y "webp\rare\rare_mrn971v8kw5.webp" "upload\rare\rare_mrn971v8kw5.webp" >nul
copy /y "webp\rare\rare_mrn9724d4yd.webp" "upload\rare\rare_mrn9724d4yd.webp" >nul
copy /y "webp\rare\rare_mrn972b8aa7.webp" "upload\rare\rare_mrn972b8aa7.webp" >nul
copy /y "webp\rare\rare_mrn972jnifr.webp" "upload\rare\rare_mrn972jnifr.webp" >nul
copy /y "webp\rare\rare_mrn972sapua.webp" "upload\rare\rare_mrn972sapua.webp" >nul
copy /y "webp\rare\rare_mrn97331ckb.webp" "upload\rare\rare_mrn97331ckb.webp" >nul
copy /y "webp\rare\rare_mrn973aiw6w.webp" "upload\rare\rare_mrn973aiw6w.webp" >nul
copy /y "webp\rare\rare_mrn973hrm9z.webp" "upload\rare\rare_mrn973hrm9z.webp" >nul
copy /y "webp\rare\rare_mrn974yiq9w.webp" "upload\rare\rare_mrn974yiq9w.webp" >nul
copy /y "webp\special\special_mrh1px9osjb.webp" "upload\special\special_mrh1px9osjb.webp" >nul
copy /y "webp\special\special_mrh1pxl0bmd.webp" "upload\special\special_mrh1pxl0bmd.webp" >nul
copy /y "webp\special\special_mrh1pxuccek.webp" "upload\special\special_mrh1pxuccek.webp" >nul
copy /y "webp\special\special_mrh1py0ucf8.webp" "upload\special\special_mrh1py0ucf8.webp" >nul
copy /y "webp\special\special_mrh1py8imsv.webp" "upload\special\special_mrh1py8imsv.webp" >nul
echo.
echo 복사 완료 - 개수 확인:
dir /s /b upload\*.webp | find /c ".webp"