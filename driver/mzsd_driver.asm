; ============================================================================
; MZSD Sound Driver v1.2  (MZ-1500 用 / 内蔵 Z80 コア (Z80dotNet) で実行)
; ============================================================================
; 機能:
;   - MZSD バイナリ音楽データ (docs/specification/binary_music_format_spec.md) を
;     解釈し、DCSG x2 (PSG1 = F2h / PSG2 = F3h)、BEEP (8253 Ch.0)、
;     YM2151 (OPM、I/O 0708h/0709h) で演奏する。
;   - フレーム同期は E008h bit7 (H-BLANK) の 1 -> 0 遷移をポーリング (実機互換)。
;   - 対応命令: NOTE / REST / TEMPO / VOLUME / VENV (音量エンベロープ) /
;     PENV (ピッチエンベロープ) / SWEEP / DETUNE / TRANSPOSE /
;     TONE (FM 音色) / LOOP_START / LOOP_END / TRACK_END + 全体ループ (L)。
;   - FM トラック (9-16 = OPM ch 0-7) は KC/KF 展開によるピッチ、
;     TL = att * 8 による音量、@FM 音色 46 パラメータのレジスタ展開に対応。
;   - エンベロープ / スイープ / ディチューンは C# リファレンス実装
;     (TrackSequencer.cs) と同一のフレーム進行で振る舞う (等価性テストで検証)。
; 構成 (メモリ):
;   0x1200        : ドライバ本体 (コード + 周波数テーブル) この後ろに music_data
;   0xF800..      : 制御ブロック / チャンネルワーク (RAM)
;   0xF7FF        : スタックトップ
; ============================================================================

        org     0x1200

; ---- I/O アドレス
PSG1_IO         equ     0xF2            ; PSG1 (左) データポート
PSG2_IO         equ     0xF3            ; PSG2 (右) データポート
BEEP_CTRL       equ     0xE007          ; 8253 コントロール (メモリマップド)
BEEP_CH0        equ     0xE004          ; 8253 Ch.0 カウンタ (メモリマップド)
VSTAT           equ     0xE008          ; ビデオステータス (bit7 = H-BLANK、write bit0 = BEEP ゲート)
FM_ADDR_IO      equ     0x0708          ; YM2151 アドレスポート (データポート = 0x0709)

; ---- 制御ブロック (統合環境から参照される固定アドレス)
CB_STATUS       equ     0xF800          ; bit0: 演奏中 / bit1: Lループ有効 / bit7: 停止要求
CB_FRAME        equ     0xF801          ; フレームカウンタ (16bit)
CB_TEMPO        equ     0xF803          ; 初期テンポ (quarterFrames >> 1、表示用)
CB_TRACKS       equ     0xF804          ; トラック数 (17)
CB_DATA         equ     0xF805          ; MZSD データ先頭アドレス (16bit)
CB_PTRS         equ     0xF808          ; 17ch x 2B: 現在データオフセット (演奏位置ハイライト用)
CB_CURI         equ     0xF82A          ; 処理中チャンネル番号 (内部ワーク)
CB_LOOPS        equ     0xF82B          ; 17ch x 2B: 全体ループ (L) 復帰オフセット
CB_VENV         equ     0xF850          ; 音量エンベロープテーブル絶対アドレス (16bit)
CB_VCNT         equ     0xF852          ; 音量エンベロープエントリ数
CB_PENV         equ     0xF853          ; ピッチエンベロープテーブル絶対アドレス (16bit)
CB_PCNT         equ     0xF855          ; ピッチエンベロープエントリ数
CB_FM           equ     0xF856          ; FM 音色テーブル絶対アドレス (16bit)
CB_FMCNT        equ     0xF858          ; FM 音色エントリ数
CH_BLOCKS       equ     0xF860          ; 17ch チャンネルブロック (64B x 17 = 1088B)
LSTACK_BASE     equ     0xFD00          ; ループスタック (17ch x 8深度 x 3B = 408B)

STAT_PLAY       equ     0x01
STAT_LOOP       equ     0x02
STAT_STOPREQ    equ     0x80

; ---- チャンネルブロック (IX + 変位)
CH_PTR          equ     0               ; 2B: 現在データオフセット (相対)
CH_LEN          equ     2               ; 2B: ノート残りフレーム
CH_GATE         equ     4               ; 2B: ゲート残りフレーム
CH_NOTE         equ     6               ; 1B: 現在ノート (トランスポーズ適用後)
CH_ATT          equ     7               ; 1B: 現在減衰量 (15 = 無音)
CH_FLAGS        equ     8               ; 1B: bit0 ended / bit1 noise / bit2 beep / bit3 FM
CH_TRANS        equ     9               ; 1B: トランスポーズ (符号付き)
CH_LDEPTH       equ     10              ; 1B: ループ深度 (0-8)
CH_PORT         equ     11              ; 1B: PSG ポート (0xF2 / 0xF3、BEEP は未使用)
CH_DCSG         equ     12              ; 1B: DCSG チャンネル (0-2 = tone、3 = noise)
CH_NOISE        equ     13              ; 1B: ノイズ制御フラグ (NOISECTL 値)
CH_HINT         equ     14              ; 1B: ノイズ分周ヒント (非連動時)
CH_VOLUME       equ     15              ; 1B: MML 音量 (0-15、15 = 最大)
CH_SIZE         equ     16              ; 基本部サイズ
CH_LPOS         equ     16              ; ループスタック [pos_lo, pos_hi, count] x 8 (24B)
CH_VENV         equ     40              ; 1B: 音量エンベロープ番号 (0xFF = 未使用)
CH_VPOS         equ     41              ; 1B: 音量エンベロープ現在位置
CH_VREL         equ     42              ; 1B: リリース中フラグ (キーオフ後はリリース区間を再生)
CH_PENV         equ     43              ; 1B: ピッチエンベロープ番号 (0xFF = 未使用)
CH_PPOS         equ     44              ; 1B: ピッチエンベロープ現在位置
CH_PVAL         equ     45              ; 2B: ピッチエンベロープ現在値 (符号付き)
CH_SWEEP        equ     47              ; 1B: スイープ速度 (符号付き、発音中フレーム毎に累積加算)
CH_DETUNE       equ     48              ; 2B: ディチューン (符号付き、レジスタ値差分)
CH_PITCH        equ     50              ; 2B: スイープ累積ピッチ変位 (NOTE 開始 / キーオフで 0)
CH_BASEP        equ     52              ; 2B: ノート基準値 (DCSG period / BEEP counter / FM pitch)
CH_TONE         equ     54              ; 1B: TONE (FM 音色番号) 直近値
CH_TOTAL        equ     64              ; チャンネルブロック総サイズ (基本部 + ループ + 拡張部)

TRACK_COUNT     equ     17
MAX_LOOP_DEPTH  equ     8

; ============================================================================
; エントリポイント / 初期化
; ============================================================================
entry:
        di
        ld      sp,0xF7FF
        call    init_work
        call    init_sound

        ; ---- MZSD ヘッダ解析
        ld      ix,music_data
        ld      a,(ix+0)
        cp      'M'
        jp      nz,boot_fail
        ld      a,(ix+1)
        cp      'Z'
        jp      nz,boot_fail
        ld      a,(ix+2)
        cp      'S'
        jp      nz,boot_fail
        ld      a,(ix+3)
        cp      'D'
        jp      nz,boot_fail

        ld      hl,music_data
        ld      (CB_DATA),hl
        ld      a,(ix+5)                ; トラック数
        ld      (CB_TRACKS),a
        ld      a,(ix+6)                ; 初期テンポ lo
        srl     a                       ; >> 1 (表示用に精度を落とす)
        ld      e,a
        ld      a,(ix+7)                ; hi
        rr      a
        ld      a,e
        ld      (CB_TEMPO),a

        ; ---- エンベロープテーブルの絶対アドレスを CB へ保存
        ld      e,(ix+12)               ; 音量エンベロープテーブル offset lo
        ld      d,(ix+13)
        ld      hl,music_data
        add     hl,de
        ld      (CB_VENV),hl
        ld      a,(ix+14)
        ld      (CB_VCNT),a
        ld      e,(ix+15)               ; ピッチエンベロープテーブル offset lo
        ld      d,(ix+16)
        ld      hl,music_data
        add     hl,de
        ld      (CB_PENV),hl
        ld      a,(ix+17)
        ld      (CB_PCNT),a
        ld      e,(ix+18)               ; FM 音色テーブル offset lo
        ld      d,(ix+19)
        ld      hl,music_data
        add     hl,de
        ld      (CB_FM),hl
        ld      a,(ix+20)
        ld      (CB_FMCNT),a

        ; トラックオフセットテーブル絶対アドレス
        ld      e,(ix+10)
        ld      d,(ix+11)
        ld      hl,music_data
        add     hl,de

        ; ---- チャンネル初期化 (トラックテーブル走査)
        ld      ix,CH_BLOCKS
        ld      bc,0                    ; bc = トラック番号
init_tracks:
        ld      a,(hl)                  ; dataOffset lo
        ld      (ix+CH_PTR),a           ; 相対オフセットのまま保存
        inc     hl
        ld      a,(hl)                  ; dataOffset hi
        ld      (ix+CH_PTR+1),a
        inc     hl                      ; loopOffset lo へ
        ld      a,(hl)
        ld      e,a
        inc     hl
        ld      a,(hl)                  ; loopOffset hi
        ld      d,a
        inc     hl                      ; 次エントリ (dataOffset lo) へ
        push    hl                      ; [B] 一時退避
        ld      hl,CB_LOOPS
        add     hl,bc
        add     hl,bc                   ; hl = CB_LOOPS + i*2
        ld      (hl),e
        inc     hl
        ld      (hl),d
        pop     hl                      ; [B] 次エントリ
        ld      a,c
        call    init_ch_regs
        ld      de,CH_TOTAL
        add     ix,de
        inc     bc
        ld      a,c
        cp      TRACK_COUNT
        jp      c,init_tracks

        ; 演奏開始 (Player が CB_STATUS へ設定した L ループビット (bit1) を保持)
        ld      a,(CB_STATUS)
        and     STAT_LOOP
        or      STAT_PLAY
        ld      (CB_STATUS),a
        call    sync_ptrs
main_loop:
        call    wait_frame
        call    process_frame
        jp      main_loop

boot_fail:
        halt

; ============================================================================
; フレーム同期 (E008h bit7 = H-BLANK の 1 -> 0 遷移を待つ = 1/60 秒)
; ============================================================================
wait_frame:
        ld      a,(VSTAT)
        bit     7,a
        jr      z,wait_frame            ; ブランキング中 -> 表示期間になるまで待つ
wf_low:
        ld      a,(VSTAT)
        bit     7,a
        jr      nz,wf_low               ; 表示中 -> ブランキングになるまで待つ
        ret

; ============================================================================
; 1 フレーム分の進行 (IX = チャンネルブロック走査に使用)
; ============================================================================
process_frame:
        ld      a,(CB_STATUS)
        bit     7,a
        jp      nz,do_stop
        bit     0,a
        ret     z                       ; 非演奏中
        ld      hl,(CB_FRAME)
        inc     hl
        ld      (CB_FRAME),hl

        ld      ix,CH_BLOCKS
        ld      b,TRACK_COUNT
pf_ch:
        push    bc
        ld      a,TRACK_COUNT
        sub     b                       ; a = チャンネル番号 (0 起)
        ld      (CB_CURI),a
        bit     0,(ix+CH_FLAGS)         ; ended?
        jr      nz,pf_next
        ; 空トラック (dataOffset = 0) は即終了扱い (C# TrackSequencer.Reset 相当)
        ld      a,(ix+CH_PTR)
        or      (ix+CH_PTR+1)
        jr      nz,pf_active
        set     0,(ix+CH_FLAGS)
        jr      pf_next
pf_active:
        ; len == 0 ならイベント実行、そうでなければ減算
        ld      a,(ix+CH_LEN)
        ld      l,a
        ld      a,(ix+CH_LEN+1)
        ld      h,a
        ld      a,h
        or      l
        jr      nz,pf_tick
        call    run_events              ; len > 0 になるまで命令を実行
        jr      pf_after
pf_tick:
        dec     hl
        ld      a,l
                ld      (ix+CH_LEN),a
        ld      a,h
                ld      (ix+CH_LEN+1),a
pf_after:
        call    gate_tick               ; ゲート終端でキーオフ
        call    venv_frame              ; 音量エンベロープ 1 フレーム進行
        call    penv_frame              ; ピッチエンベロープ 1 フレーム進行
        call    pitch_frame             ; スイープ / ディチューン / PENV をレジスタへ反映
pf_next:
        ld      de,CH_TOTAL
        add     ix,de
        pop     bc
        djnz    pf_ch

        ; ---- 全トラック終了判定
        ld      ix,CH_BLOCKS
        ld      b,TRACK_COUNT
        xor     a                       ; active フラグ
pf_chk:
        bit     0,(ix+CH_FLAGS)
        jr      nz,pf_chk2
        set     0,a                     ; 進行中トラックあり
pf_chk2:
        ld      de,CH_TOTAL
        add     ix,de
        djnz    pf_chk
        bit     0,a
        jp      nz,pf_end               ; 進行中あり -> 継続

        ; 全トラック終了: L ループ復帰 or 停止
        ld      a,(CB_STATUS)
        bit     1,a
        jr      z,ps_stop
        call    loop_rewind
        jr      pf_end
ps_stop:
        ; 自然終了: 各トラックは ev_end -> do_keyoff 済みのためレジスタは終了状態のまま
        ; (C# MzsdSequencer も終了時にチップ状態を変更しない。all_keyoff は停止要求時のみ)
        ld      a,(CB_STATUS)
        res     0,a                     ; 演奏中 OFF
        ld      (CB_STATUS),a
        call    sync_ptrs
        halt
pf_end:
        call    sync_ptrs
        ret

do_stop:
        call    all_keyoff
        ld      a,(CB_STATUS)
        res     0,a
        ld      (CB_STATUS),a
        call    sync_ptrs
        halt

; ---- ゲート終端処理 (IX = チャンネル)
gate_tick:
        ld      a,(ix+CH_GATE)
        ld      l,a
        ld      a,(ix+CH_GATE+1)
        ld      h,a
        ld      a,h
        or      l
        ret     z                       ; ゲート残りなし (ノートオフ状態)
        dec     hl
        ld      a,l
                ld      (ix+CH_GATE),a
        ld      a,h
                ld      (ix+CH_GATE+1),a
        ld      a,h
        or      l
        ret     nz                      ; まだゲート中
        call    do_keyoff               ; キーオフ (venv 有効時はリリース区間へ)
        ret

; ---- 全チャンネルのキーオフ (音源消音)
all_keyoff:
        push    bc
        push    ix
        ld      ix,CH_BLOCKS
        ld      b,TRACK_COUNT
ak_loop:
        push    bc
        ld      a,15
        ld      (ix+CH_ATT),a
        call    write_att
        ld      de,CH_TOTAL
        add     ix,de
        pop     bc
        djnz    ak_loop
        pop     ix
        pop     bc
        ret

; ---- 全チャンネルの現在 ptr を制御ブロックへコピー (ハイライト用)
sync_ptrs:
        push    bc
        push    de
        push    hl
        push    ix
        ld      ix,CH_BLOCKS
        ld      hl,CB_PTRS
        ld      b,TRACK_COUNT
sp_loop:
        ld      e,(ix+CH_PTR)
        ld      d,(ix+CH_PTR+1)
        ld      (hl),e
        inc     hl
        ld      (hl),d
        inc     hl
        ld      de,CH_TOTAL
        add     ix,de
        djnz    sp_loop
        pop     ix
        pop     hl
        pop     de
        pop     bc
        ret

; ---- 全体ループ (L) 復帰: loopOffset > 0 のチャンネルを復帰点へリセット
loop_rewind:
        push    bc
        push    de
        push    hl
        push    ix
        ld      ix,CH_BLOCKS
        ld      hl,CB_LOOPS
        ld      b,TRACK_COUNT
lr_loop:
        push    bc
        ld      e,(hl)
        inc     hl
        ld      d,(hl)
        inc     hl
        ld      a,d
        or      e
        jr      z,lr_next               ; L なし
        ld      (ix+CH_PTR),e
        ld      (ix+CH_PTR+1),d
        ld      (ix+CH_LEN),0
        ld      (ix+CH_LEN+1),0
        ld      (ix+CH_GATE),0
        ld      (ix+CH_GATE+1),0
        ld      (ix+CH_LDEPTH),0
        res     0,(ix+CH_FLAGS)         ; ended クリア
        ld      (ix+CH_VREL),0          ; リリース状態解除 (C# Reset 相当)
        call    do_keyoff               ; キーオフ (リセット相当)
lr_next:
        ld      de,CH_TOTAL
        add     ix,de
        pop     bc
        djnz    lr_loop
        pop     ix
        pop     hl
        pop     de
        pop     bc
        ret

; ============================================================================
; MZSD イベント実行 (IX = チャンネル)。len > 0 になる (NOTE / REST / 終了) まで回す。
; ============================================================================
run_events:
        ld      a,(ix+CH_PTR)
        ld      l,a
        ld      a,(ix+CH_PTR+1)
        ld      h,a
        ld      de,(CB_DATA)
        add     hl,de                   ; hl = 絶対データポインタ
re_loop:
        ; CH_PTR (相対) から毎回絶対アドレスを再計算する
        ; (update_ptr が hl を相対値に書き換えるため、re_loop 再入時は必須)
        ld      a,(ix+CH_PTR)
        ld      l,a
        ld      a,(ix+CH_PTR+1)
        ld      h,a
        ld      de,(CB_DATA)
        add     hl,de
        ld      a,(hl)
        inc     hl
        or      a
        jp      z,ev_note               ; 0x00 NOTE
        dec     a
        jp      z,ev_rest               ; 0x01 REST
        dec     a
        jp      z,ev_skip2              ; 0x02 TEMPO (長さは焼き込み済み)
        dec     a
        jp      z,ev_volume             ; 0x03 VOLUME
        dec     a
        jp      z,ev_venv               ; 0x04 VENV (音量エンベロープ)
        dec     a
        jp      z,ev_penv               ; 0x05 PENV (ピッチエンベロープ)
        dec     a
        jp      z,ev_sweep              ; 0x06 SWEEP
        dec     a
        jp      z,ev_detune             ; 0x07 DETUNE
        dec     a
        jp      z,ev_transpose          ; 0x08 TRANSPOSE
        dec     a
        jp      z,ev_tone               ; 0x09 TONE (FM 音色選択)
        dec     a
        jp      z,ev_noisectl           ; 0x0A NOISECTL
        dec     a
        jp      z,ev_loopstart          ; 0x0B LOOP_START
        dec     a
        jp      z,ev_loopend            ; 0x0C LOOP_END
        jp      ev_end                  ; 0x0D GOTO (不使用) / 0x0E TRACK_END / 不明命令

; ---- NOTE: note(1) len(2) gate(2)
ev_note:
        ld      a,(hl)
        ex      af,af'                  ; a' = note
        inc     hl
        ld      c,(hl)
        inc     hl
        ld      b,(hl)                  ; bc = len
        inc     hl
        push    bc                      ; [1] len
        ld      c,(hl)
        inc     hl
        ld      b,(hl)                  ; bc = gate
        inc     hl
        push    bc                      ; [2] gate
        call    update_ptr              ; hl -> ix+CH_PTR
        pop     bc                      ; [2] bc = gate
        pop     de                      ; [1] de = len
        ; gate = min(gate, len)
        ld      l,c
        ld      h,b                     ; hl = gate
        push    de
        or      a                       ; cy クリア
        sbc     hl,de                   ; hl = gate - len
        pop     de
        jr      c,ev_n_ok               ; gate < len
        ld      b,d
        ld      c,e                     ; gate = len
ev_n_ok:
        ld      (ix+CH_GATE),c
        ld      (ix+CH_GATE+1),b
        ; len == 0 は 1 に補正し、実行フレーム分を即時消費 (C# TrackSequencer.Tick 相当)
        ld      a,d
        or      e
        jr      nz,ev_n_l
        ld      de,1
ev_n_l:
        dec     de
        ld      (ix+CH_LEN),e
        ld      (ix+CH_LEN+1),d
        ; att = 15 - volume (発音時に復帰)
        ld      a,15
        sub     (ix+CH_VOLUME)
        ld      (ix+CH_ATT),a
        ; venv / penv をノート先頭へ戻す、スイープ累積リセット (C# StartNote 相当)
        ld      a,(ix+CH_VENV)
        cp      0xFF
        jr      z,en_nov
        ld      (ix+CH_VPOS),0
        ld      (ix+CH_VREL),0
en_nov:
        ld      a,(ix+CH_PENV)
        cp      0xFF
        jr      z,en_nop
        ld      (ix+CH_PPOS),0
        ld      (ix+CH_PVAL),0
        ld      (ix+CH_PVAL+1),0
en_nop:
        xor     a
        ld      (ix+CH_PITCH),a
        ld      (ix+CH_PITCH+1),a
        ex      af,af'                  ; a = note
        add     a,(ix+CH_TRANS)
        call    play_note
        ret

; ---- REST: len(2)
ev_rest:
        ld      c,(hl)
        inc     hl
        ld      b,(hl)
        inc     hl
        ld      a,b
        or      c
        jr      nz,er_l
        ld      bc,1
er_l:
        dec     bc                      ; 実行フレーム分を即時消費 (C# Tick 相当)
        ld      (ix+CH_LEN),c
        ld      (ix+CH_LEN+1),b
        push    hl
        call    do_keyoff               ; キーオフ (venv 有効時はリリース区間へ)
        pop     hl
        call    update_ptr
        ret

; ---- VOLUME: v(1)
ev_volume:
        ld      a,(hl)
        inc     hl
        cp      16
        jr      c,ev_v1
        ld      a,15
ev_v1:
        ld      (ix+CH_VOLUME),a
        ld      (ix+CH_VENV),0xFF       ; 音量指定でエンベロープ解除 (C# OpVolume 相当)
        ld      (ix+CH_VREL),0
        neg
        add     a,15                    ; att = 15 - volume
        ld      (ix+CH_ATT),a
        push    hl
        call    write_att
        pop     hl
        call    update_ptr
        jp      re_loop

; ---- VENV: id(1) (0xFF = 解除)
ev_venv:
        ld      e,(hl)
        inc     hl
        ld      a,(CB_VCNT)
        or      a
        jr      z,ev_venv_off           ; テーブル無し
        ld      a,e
        cp      0xFF
        jr      z,ev_venv_off           ; 解除指定
        ld      (ix+CH_VENV),a
        ld      (ix+CH_VPOS),0
        ld      (ix+CH_VREL),0
        ; (att は同フレーム内の venv_frame が書き込む = C# と同一)
        jr      ev_venv_done
ev_venv_off:
        ld      (ix+CH_VENV),0xFF
        ld      (ix+CH_VREL),0
        ld      a,15
        sub     (ix+CH_VOLUME)
        ld      (ix+CH_ATT),a
        push    hl
        call    write_att
        pop     hl
ev_venv_done:
        call    update_ptr
        jp      re_loop

; ---- PENV: id(1) (0xFF = 解除)
ev_penv:
        ld      e,(hl)
        inc     hl
        ld      a,(CB_PCNT)
        or      a
        jr      z,ev_penv_off           ; テーブル無し
        ld      a,e
        cp      0xFF
        jr      z,ev_penv_off           ; 解除指定
        ld      (ix+CH_PENV),a
        jr      ev_penv_common
ev_penv_off:
        ld      (ix+CH_PENV),0xFF
ev_penv_common:
        ld      (ix+CH_PPOS),0
        ld      (ix+CH_PVAL),0
        ld      (ix+CH_PVAL+1),0
        call    update_ptr
        jp      re_loop

; ---- SWEEP: val(1) (符号付き)
ev_sweep:
        ld      a,(hl)
        inc     hl
        ld      (ix+CH_SWEEP),a
        call    update_ptr
        jp      re_loop

; ---- DETUNE: val(2) (符号付き)
ev_detune:
        ld      a,(hl)
        inc     hl
        ld      (ix+CH_DETUNE),a
        ld      a,(hl)
        inc     hl
        ld      (ix+CH_DETUNE+1),a
        call    update_ptr
        jp      re_loop

; ---- オペランド読み飛ばし (1B / 2B)

ev_skip1:
        inc     hl
        call    update_ptr
        jp      re_loop

ev_skip2:
        inc     hl
        inc     hl
        call    update_ptr
        jp      re_loop

; ---- TRANSPOSE: val(1)
ev_transpose:
        ld      a,(hl)
        inc     hl
        ld      (ix+CH_TRANS),a
        call    update_ptr
        jp      re_loop

; ---- TONE: id(1) — FM 音色選択 (FM トラックのみレジスタ適用、C# OpTone 相当)
ev_tone:
        ld      a,(hl)
        inc     hl
        ld      (ix+CH_TONE),a
        ld      e,a                     ; e = 音色番号
        ld      a,(ix+CH_FLAGS)
        bit     3,a
        jr      z,ev_tone_n
        ld      a,(CB_FMCNT)
        or      a
        jr      z,ev_tone_n             ; 音色テーブル無し
        dec     a
        ld      b,a                     ; b = 最大音色番号
        ld      a,e
        cp      b
        jr      nc,ev_tone_n            ; 範囲外 -> スキップ (C# 同一)
        ld      a,e
        call    apply_fm_tone
ev_tone_n:
        call    update_ptr
        jp      re_loop

; ---- NOISECTL: flags(1)
ev_noisectl:
        ld      a,(hl)
        inc     hl
        ld      (ix+CH_NOISE),a
        bit     1,(ix+CH_FLAGS)
        jr      z,enc_c
        push    hl
        call    apply_noise             ; ノイズトラックは即レジスタ反映
        pop     hl
enc_c:
        call    update_ptr
        jp      re_loop

; ---- LOOP_START
ev_loopstart:
        ld      a,(ix+CH_LDEPTH)
        cp      MAX_LOOP_DEPTH
        jr      nc,els_cont             ; 深すぎる場合はネスト無視
        push    de
        push    hl                      ; [1] 絶対位置
        ld      de,(CB_DATA)
        or      a
        sbc     hl,de                   ; hl = 相対位置
        push    hl                      ; [2]
        ld      e,(ix+CH_LDEPTH)
        call    ls_addr_d               ; hl = ループスタックエントリ (深度は e で渡す)
        pop     de                      ; [2] de = 相対位置
        ld      (hl),e
        inc     hl
        ld      (hl),d
        inc     hl
        ld      (hl),0xFF               ; remaining 未初期化マーク
        ld      a,(ix+CH_LDEPTH)
        inc     a
        ld      (ix+CH_LDEPTH),a
        pop     hl                      ; [1]
        pop     de
els_cont:
        call    update_ptr
        jp      re_loop

; ---- LOOP_END: count(1)
ev_loopend:
        ld      c,(hl)                  ; c = count
        inc     hl
        ld      a,(ix+CH_LDEPTH)
        or      a
        jr      z,ele_cont              ; 深度 0 -> 無視
        dec     a
        push    hl                      ; [1]
        push    bc                      ; [2] count
        ld      e,a
        push    de                      ; [3] depth index
        call    ls_addr_d               ; hl = エントリ (e = depth)
        inc     hl
        inc     hl
        ld      a,(hl)
        cp      0xFF
        jr      nz,ele_h
        ld      (hl),c                  ; remaining = count (初回)
ele_h:
        dec     (hl)                    ; remaining--
        ld      a,(hl)
        or      a
        jr      z,ele_done              ; remaining == 0 -> ネスト終了
        ; ジャンプ (depth 変更なし)
        dec     hl
        dec     hl
        ld      e,(hl)
        inc     hl
        ld      d,(hl)                  ; de = 相対位置
        ld      hl,(CB_DATA)
        add     hl,de                   ; hl = 絶対
        call    update_ptr
        pop     de                      ; [3]
        pop     bc                      ; [2]
        pop     hl                      ; [1]
        jp      re_loop
ele_done:
        pop     de                      ; [3] depth index
        ld      a,e
        ld      (ix+CH_LDEPTH),a        ; depth--
        pop     bc                      ; [2]
        pop     hl                      ; [1]
ele_cont:
        call    update_ptr
        jp      re_loop

; ---- TRACK_END / 不明命令: トラック終了
ev_end:
        set     0,(ix+CH_FLAGS)
        call    do_keyoff               ; キーオフ (C# TrackEnd -> KeyOff 相当)
        ret

; ---- 現在の hl (絶対) を ix+CH_PTR へ相対で保存
update_ptr:
        push    de
        ld      de,(CB_DATA)
        or      a
        sbc     hl,de
        ld      a,l
                ld      (ix+CH_PTR),a
        ld      a,h
                ld      (ix+CH_PTR+1),a
        pop     de
        ret

; ---- ループスタックエントリアドレス
;   ls_addr_d: e = depth / ls_addr: a = depth  ->  hl = LSTACK_BASE + cur*24 + depth*3
ls_addr_d:
        push    af
        ld      a,e
        call    ls_addr
        pop     af
        ret

ls_addr:
        push    de
        ld      e,a
        add     a,a
        add     a,e                     ; a = depth*3
        ld      e,a
        ld      d,0
        ld      hl,LSTACK_BASE
        add     hl,de
        ld      a,(CB_CURI)
        add     a,a
        ld      e,a
        add     a,a
        add     a,e                     ; cur*6
        add     a,a
        add     a,a                     ; cur*24
        ld      e,a
        ld      d,0
        add     hl,de
        pop     de
        ret

; ============================================================================
; 音源出力 (IX = チャンネル)
; ============================================================================
; ---- ノート発音: a = note (トランスポーズ適用前)
play_note:
        push    af
        ld      a,(ix+CH_FLAGS)
        bit     3,a                     ; FM? (clamp せず生値を使うため最初に分岐)
        jr      z,pn_not_fm
        pop     af
        jp      play_fm
pn_not_fm:
        pop     af
        ; clamp (note + transpose) を 0-127 へ
        bit     7,a
        jr      z,pn_nc
        xor     a
        jr      pn_ok
pn_nc:
        cp      128
        jr      c,pn_ok
        ld      a,127
pn_ok:
        ld      (ix+CH_NOTE),a
        bit     2,(ix+CH_FLAGS)         ; BEEP?
        jp      nz,play_beep
        bit     1,(ix+CH_FLAGS)         ; ノイズ?
        jp      nz,play_noise
        jp      play_dcs                ; PSG tone (fall-through 経路を明示)

; ---- FM ノート発音: a = note + transpose (clamp なし、C# StartNote と同一)
play_fm:
        push    bc
        push    de
        push    hl
        ld      l,a
        ld      h,0
        ld      a,(ix+CH_TRANS)         ; transpose 符号で判定 (note+trans > 127 の場合があるため)
        bit     7,a
        jr      z,pfm_pos               ; transpose >= 0 → 結果は必ず正 (0-254)
        bit     7,l                     ; transpose < 0 → 結果が負かチェック
        jr      z,pfm_pos               ; 結果 >= 0 → 正
        ld      h,0xFF                  ; 符号拡張 (結果が負)
pfm_pos:
        ld      bc,0xFFC4               ; -60 (C4 基準)
        add     hl,bc                   ; hl = note + transpose - 60
        add     hl,hl
        add     hl,hl
        add     hl,hl
        add     hl,hl
        add     hl,hl
        add     hl,hl                   ; hl = base (1 セミトーン = 64)
        ld      a,l
        ld      (ix+CH_BASEP),a         ; スイープ / PENV / D 用の基準値
        ld      a,h
        ld      (ix+CH_BASEP+1),a
        ; total = base + (detune + pval + スイープ累積) (C# ApplyPitchFrame と同一)
        ld      e,(ix+CH_DETUNE)
        ld      d,(ix+CH_DETUNE+1)
        ld      a,(ix+CH_PVAL)
        add     a,e
        ld      e,a
        ld      a,(ix+CH_PVAL+1)
        adc     a,d
        ld      d,a                     ; de = detune + pval
        ld      c,(ix+CH_PITCH)
        ld      b,(ix+CH_PITCH+1)
        add     hl,bc                   ; + スイープ累積
        add     hl,de                   ; hl = total
        call    fm_pitch_emit           ; KC / KF 出力
        pop     hl
        pop     de
        pop     bc
        call    write_att               ; TL 出力 (ノート開始時の減衰量)
        ld      a,(ix+CH_PORT)          ; Key On: slot bits (4 op) + channel
        or      0x78
        ld      c,a
        ld      a,0x08
        call    write_fm
        ret

; ---- DCSG tone: period テーブル -> ベース値保存 + レジスタ出力
play_dcs:
        push    bc
        push    de
        push    hl
        ld      l,a
        ld      h,0
        add     hl,hl                   ; hl = note*2
        ld      de,note_dctbl
        add     hl,de
        ld      e,(hl)
        inc     hl
        ld      d,(hl)                  ; de = period (0-1023)
        ld      (ix+CH_BASEP),e         ; スイープ / PENV / D 用の基準値
        ld      (ix+CH_BASEP+1),d
        pop     hl
        pop     de
        pop     bc
        call    write_period
        jp      write_att               ; ノート開始時の減衰量も出力 (C# StartNote 相当)

; ---- YM2151 レジスタ書き込み: a = レジスタ番号、c = 値 (全レジスタ保護)
;      実機では書き込み間にバス待ち (~8 マイクロ秒) があるが、
;      内蔵コア / エミュレータはポート書き込みのみで状態が確定するため待ちなし
write_fm:
        push    af
        push    bc
        push    de
        ld      e,a
        ld      d,c                     ; de = (レジスタ, 値)
        ld      bc,FM_ADDR_IO           ; 0x0708 (アドレスポート)
        out     (c),e
        inc     c                       ; 0x0709 (データポート)
        out     (c),d
        pop     de
        pop     bc
        pop     af
        ret

; ---- YM2151 へ 4 オペレータ同一値を書き込み: b = ベースレジスタ (0x40 系)、
;      c = 値、e = チャンネル (0-7)。reg = b + op*8 + ch (op = 0-3)
write_fm4:
        push    af
        push    bc
        push    de
        push    hl
        ld      h,c                     ; h = 値
        ld      l,0                     ; l = op * 8
wfm4_loop:
        ld      a,b
        add     a,l
        add     a,e                     ; a = レジスタ番号
        ld      c,h
        call    write_fm
        ld      a,l
        add     a,8
        ld      l,a
        cp      32
        jr      c,wfm4_loop
        pop     hl
        pop     de
        pop     bc
        pop     af
        ret

; ---- DCSG トーン周期出力: IX = チャンネル、de = period (0-1023)
;      fine = 0x80|(ch<<5)|(p&0x0F)、coarse = (p>>4)&0x3F
write_period:
        push    af
        push    bc
        push    de
        push    hl
        ld      c,(ix+CH_PORT)
        ld      b,0
        ld      a,(ix+CH_DCSG)
        add     a,a
        add     a,a
        add     a,a
        add     a,a
        add     a,a                     ; a = ch<<5 (DCSG レジスタのチャンネル位置)
        ld      l,a
        ; coarse: (d << 4) | (e >> 4) = (period >> 4) & 0x3F
        ld      a,d
        add     a,a
        add     a,a
        add     a,a
        add     a,a
        ld      d,a                     ; d = d << 4
        ld      a,e
        and     0xF0
        srl     a
        srl     a
        srl     a
        srl     a
        or      d
        ld      d,a                     ; d = coarse バイト
        ; fine: 0x80|(ch<<5)|(p & 0x0F)
        ld      a,e
        and     0x0F
        or      l
        or      0x80
        ld      e,a                     ; e = fine バイト
        out     (c),e
        out     (c),d
        pop     hl
        pop     de
        pop     bc
        pop     af
        ret

; ---- ノイズ: 分周ヒント更新 + (同期時) tone2 へ音程 / ノイズ制御
play_noise:
        push    bc
        push    de
        push    hl
        ld      l,a
        ld      h,0
        add     hl,hl
        ld      de,note_dctbl
        add     hl,de
        ld      e,(hl)
        inc     hl
        ld      d,(hl)                  ; de = period
        ; hint: p == 0 -> 0 / p == 1 -> 1 / else 2 (C# StartNote の分周ヒントと同一)
        ld      a,d
        or      a
        jr      nz,pn_2
        ld      a,e
        or      a
        jr      z,pn_0
        cp      1
        jr      z,pn_1
        ld      a,2
        jr      pn_store
pn_0:
        xor     a
        jr      pn_store
pn_2:
        ld      a,2
        jr      pn_store
pn_1:
        ld      a,1
pn_store:
        ld      (ix+CH_HINT),a
        ; 同期モードは同一 PSG の tone2 へ音程を書く (実機結線に準拠)
        ld      a,(ix+CH_NOISE)
        and     0x06
        jr      z,pn_ctrl
        ld      c,(ix+CH_PORT)
        ld      b,0
        ; coarse 先に計算 (fine バイトを e へ入れると period 下位が失われるため)
        ld      a,d
        add     a,a
        add     a,a
        add     a,a
        add     a,a                     ; a = d << 4
        ld      d,a
        ld      a,e
        and     0xF0
        srl     a
        srl     a
        srl     a
        srl     a                       ; a = e >> 4
        or      d
        and     0x3F
        ld      d,a                     ; d = coarse = (period >> 4) & 0x3F
        ; fine ラッチ: 0xC0 | (period & 0x0F)
        ld      a,e
        and     0x0F
        or      0xC0
        ld      e,a
        out     (c),e                   ; tone2 fine ラッチ
        ld      e,d
        out     (c),e                   ; tone2 coarse
pn_ctrl:
        call    apply_noise
        pop     hl
        pop     de
        pop     bc
        jp      write_att               ; チャンネル減衰 (CH_ATT) も出力する

; ---- BEEP: counter テーブル -> ベース値保存 + 8253 Ch.0 出力 (CTRL -> LSB -> MSB)
play_beep:
        push    bc
        push    de
        push    hl
        ld      l,a
        ld      h,0
        add     hl,hl
        ld      de,note_beep_tbl
        add     hl,de
        ld      e,(hl)
        inc     hl
        ld      d,(hl)                  ; de = counter (1-65535)
        ld      (ix+CH_BASEP),e         ; スイープ / PENV / D 用の基準値
        ld      (ix+CH_BASEP+1),d
        ex      de,hl                   ; hl = counter
        call    write_beep_counter
        ; ゲート = att < 15
        ld      a,(ix+CH_ATT)
        cp      15
        ld      a,1
        jr      c,pb_g
        xor     a
pb_g:
        ld      (VSTAT),a               ; E008h bit0 で 8253 ゲート制御
        pop     hl
        pop     de
        pop     bc
        ret

; ---- 8253 Ch.0 カウンタ出力: hl = counter
write_beep_counter:
        push    af
        ld      a,0x36                  ; Ch.0 / LSB+MSB 書き込み / mode 3 (矩形波)
        ld      (BEEP_CTRL),a
        ld      a,l
        ld      (BEEP_CH0),a
        ld      a,h
        ld      (BEEP_CH0),a
        pop     af
        ret

; ---- 減衰量出力: DCSG = attenuation レジスタ / BEEP = ゲート
write_att:
        push    af
        push    bc
        push    de
        bit     2,(ix+CH_FLAGS)         ; BEEP?
        jr      nz,wa_beep
        ld      a,(ix+CH_FLAGS)
        bit     3,a                     ; FM?
        jp      nz,wa_fm
        ld      c,(ix+CH_PORT)
        ld      b,0
        ld      a,(ix+CH_DCSG)
        add     a,a
        add     a,a
        add     a,a
        add     a,a
        add     a,a                     ; a = ch<<5 (DCSG レジスタのチャンネル位置)
        or      0x90
        or      (ix+CH_ATT)
        ld      e,a
        out     (c),e
        jr      wa_done
wa_beep:
        ld      a,(ix+CH_ATT)
        cp      15
        ld      a,1
        jr      c,wa_b2
        xor     a
wa_b2:
        ld      (VSTAT),a
wa_done:
        pop     de
        pop     bc
        pop     af
        ret

; ---- ノイズ制御レジスタ出力: 0xE0 | (white << 2) | rate
apply_noise:
        push    af
        push    bc
        push    de
        ld      d,(ix+CH_NOISE)         ; bit0 = white / bit1-2 = 同期モード
        ld      c,(ix+CH_HINT)          ; c = 分周ヒント
        ld      a,d
        and     0x06
        jr      z,an_async
        ld      c,3                     ; 同期 = rate 3 (tone2 連動)
an_async:
        ld      a,d
        and     0x01
        add     a,a
        add     a,a                     ; white << 2
        or      0xE0
        or      c
        push    af
        ld      a,(ix+CH_PORT)
        ld      b,0
        ld      c,a
        pop     af
        ld      e,a
        out     (c),e
        pop     de
        pop     bc
        pop     af
        ret

; ============================================================================
; FM 音源 (YM2151 / OPM) 出力 — C# TrackSequencer と同一動作
; ============================================================================

; ---- FM 減衰量出力 (write_att の FM 分岐): TL = att * 8 (0-120) を 4 op へ
;      (フェーダー TL トリムは内蔵コア側では 0 固定 = C# GetFmTrim 既定値と等価)
;      write_att から jp で入るため、末尾は wa_done (write_att の pop + ret) へ戻る
wa_fm:
        ld      a,(ix+CH_ATT)
        add     a,a
        add     a,a
        add     a,a                     ; a = TL
        ld      c,a
        ld      a,(ix+CH_PORT)
        ld      e,a                     ; e = FM チャンネル (0-7)
        ld      b,0x60
        call    write_fm4               ; reg = 0x60 + op*8 + ch
        jp      wa_done

; ---- FM 用 total 計算: hl = CH_BASEP + (DETUNE + PENV値 + SWEEP累積)
;      C# ApplyPitchFrame の total と同一 (play_fm / pitch_frame から使用)
fm_calc_total:
        push    bc
        push    de
        ld      a,(ix+CH_BASEP)
        ld      l,a
        ld      a,(ix+CH_BASEP+1)
        ld      h,a
        ld      e,(ix+CH_DETUNE)
        ld      d,(ix+CH_DETUNE+1)
        ld      a,(ix+CH_PVAL)
        add     a,e
        ld      e,a
        ld      a,(ix+CH_PVAL+1)
        adc     a,d
        ld      d,a                     ; de = detune + pval
        ld      c,(ix+CH_PITCH)
        ld      b,(ix+CH_PITCH+1)
        add     hl,bc                   ; + スイープ累積
        add     hl,de                   ; + detune + pval
        pop     de
        pop     bc
        ret

; ---- FM ピッチ出力: hl = total (符号付き 16bit、C4 = 0 / 1 セミトーン = 64)
;      -> KC (0x28+ch) / KF (0x30+ch)。C# ApplyPitchFrame の FM 分岐と同一:
;      semitones = total >> 6 (算術)、fraction = total & 63、
;      octave = 4 + floor(semitones / 12) (0 / 7 にクランプ、クランプ時 KF は 0 / 63)
fm_pitch_emit:
        push    hl                      ; total 退避
        sra     h
        rr      l
        sra     h
        rr      l
        sra     h
        rr      l
        sra     h
        rr      l
        sra     h
        rr      l
        sra     h
        rr      l                       ; hl = semitones (符号付き)
        ld      a,h
        bit     7,a
        jr      nz,fpe_neg              ; semitones < 0
        or      a
        jr      nz,fpe_hi               ; semitones >= 256
        ld      a,l
        cp      48
        jr      nc,fpe_hi               ; semitones >= 48 (octave >= 8)
        jr      fpe_adj
fpe_neg:
        ld      a,h
        cp      0xFF
        jr      nz,fpe_lo               ; semitones <= -256
        ld      a,l
        cp      208
        jr      c,fpe_lo                ; semitones <= -49 (octave < 0)
fpe_adj:
        ; |semitones| <= 48: +12 / -12 の調整で octave (b) と noteIndex (l) を求める
        ld      b,4                     ; 基準オクターブ (C4)
fpe_loop:
        bit     7,l
        jr      nz,fpe_l2
        ld      a,l
        cp      12
        jr      c,fpe_l3
        sub     12
        ld      l,a
        inc     b
        jr      fpe_loop
fpe_l2:
        ld      a,l
        add     a,12
        ld      l,a
        dec     b
        jr      fpe_loop
fpe_l3:
        ; KC = (octave << 4) | fmnotecode[noteIndex]
        push    bc
        ld      c,l
        ld      b,0
        ld      hl,fmnotecode
        add     hl,bc
        ld      a,(hl)
        pop     bc
        ld      c,a
        ld      a,b
        add     a,a
        add     a,a
        add     a,a
        add     a,a                     ; a = octave << 4
        or      c
        ld      b,a                     ; b = KC
        pop     hl                      ; hl = total
        push    hl
        ld      a,l
        and     0x3F
        ld      c,a                     ; c = KF = fraction
        jr      fpe_emit
fpe_hi:
        ld      b,0x7E                  ; octave 7 / note code 11 (= 14)
        ld      c,63
        jr      fpe_emit
fpe_lo:
        ld      b,0x00
        ld      c,0
fpe_emit:
        push    bc                      ; b = KC / c = KF 退避
        ld      a,(ix+CH_PORT)
        add     a,0x28
        ld      c,b
        call    write_fm                ; KC 出力
        pop     bc
        ld      a,(ix+CH_PORT)
        add     a,0x30
        call    write_fm                ; KF 出力
        pop     hl                      ; total 破棄 (スタック整合)
        ret

; ---- OPM ノートコード (C = 0, C# = 1, D = 2, D# = 4, ..., B = 14)
fmnotecode:
        db      0, 1, 2, 4, 5, 6, 8, 9, 10, 12, 13, 14

; ---- @FM 音色 (46 パラメータ) を OPM レジスタへ展開 (C# ApplyFmTone と同一)
;      a = 音色番号、IX = チャンネル。全レジスタ保護
apply_fm_tone:
        push    af
        push    bc
        push    de
        push    hl
        ld      e,a
        call    fmtone_addr             ; hl = 音色データ先頭 (p[0])
        ld      a,(ix+CH_PORT)
        ld      d,a                     ; d = FM チャンネル
        ; reg 0x20+ch = 0xC0 | (FB << 3) | ALG   <- p1, p0
        ld      a,(hl)
        and     0x07
        ld      c,a
        inc     hl
        ld      a,(hl)
        and     0x07
        add     a,a
        add     a,a
        add     a,a
        or      c
        or      0xC0
        ld      c,a
        ld      a,0x20
        add     a,d
        call    write_fm
        inc     hl                      ; hl = p[2] (Op1 先頭)
        ld      e,0                     ; e = オペレータ番号
aft_op:
        push    hl
        push    de
        ; reg 0x40+op*8+ch = (AME << 7) | (DT1 << 4) | MUL   <- p10, p8, p7
        ld      bc,7
        add     hl,bc                   ; p7
        ld      a,(hl)
        and     0x0F
        ld      c,a
        inc     hl                      ; p8
        ld      a,(hl)
        and     0x07
        add     a,a
        add     a,a
        add     a,a
        add     a,a
        or      c
        ld      c,a
        inc     hl
        inc     hl                      ; p10
        ld      a,(hl)
        and     0x01
        add     a,a
        add     a,a
        add     a,a
        add     a,a
        add     a,a
        add     a,a
        add     a,a
        or      c
        ld      c,a
        ld      b,0x40
        call    aft_reg
        call    write_fm
        pop     de
        pop     hl
        push    hl
        push    de
        ; reg 0x60+op*8+ch = TL   <- p5
        ld      bc,5
        add     hl,bc
        ld      a,(hl)
        and     0x7F
        ld      c,a
        ld      b,0x60
        call    aft_reg
        call    write_fm
        pop     de
        pop     hl
        push    hl
        push    de
        ; reg 0x80+op*8+ch = (KS << 6) | AR   <- p6, p0
        ld      a,(hl)
        and     0x1F
        ld      c,a
        push    bc
        ld      bc,6
        add     hl,bc
        ld      a,(hl)
        and     0x03
        add     a,a
        add     a,a
        add     a,a
        add     a,a
        add     a,a
        add     a,a
        pop     bc
        or      c
        ld      c,a
        ld      b,0x80
        call    aft_reg
        call    write_fm
        pop     de
        pop     hl
        push    hl
        push    de
        ; reg 0xA0+op*8+ch = D1R   <- p1
        ld      bc,1
        add     hl,bc
        ld      a,(hl)
        and     0x1F
        ld      c,a
        ld      b,0xA0
        call    aft_reg
        call    write_fm
        pop     de
        pop     hl
        push    hl
        push    de
        ; reg 0xC0+op*8+ch = (DT2 << 6) | D2R   <- p9, p2
        ld      bc,2
        add     hl,bc
        ld      a,(hl)
        and     0x1F
        ld      c,a
        push    bc
        ld      bc,9
        add     hl,bc
        ld      a,(hl)
        and     0x03
        add     a,a
        add     a,a
        add     a,a
        add     a,a
        add     a,a
        add     a,a
        pop     bc
        or      c
        ld      c,a
        ld      b,0xC0
        call    aft_reg
        call    write_fm
        pop     de
        pop     hl
        push    hl
        push    de
        ; reg 0xE0+op*8+ch = (D1L << 4) | RR   <- p4, p3
        ld      bc,3
        add     hl,bc                   ; p3
        ld      a,(hl)
        and     0x0F
        ld      c,a
        inc     hl                      ; p4
        ld      a,(hl)
        and     0x0F
        add     a,a
        add     a,a
        add     a,a
        add     a,a
        or      c
        ld      c,a
        ld      b,0xE0
        call    aft_reg
        call    write_fm
        pop     de
        pop     hl
        ld      bc,11
        add     hl,bc                   ; 次オペレータの p0 へ
        inc     e
        ld      a,e
        cp      4
        jp      c,aft_op
        pop     hl
        pop     de
        pop     bc
        pop     af
        ret

; ---- レジスタ番号計算: a = b + op*8 + ch (b = ベース、e = op、d = ch)
aft_reg:
        ld      a,e
        add     a,a
        add     a,a
        add     a,b
        add     a,d
        ret

; ---- FM 音色テーブルのエントリアドレス: e = 音色番号 -> hl = 絶対アドレス
fmtone_addr:
        push    de
        ld      l,e
        ld      h,0
        add     hl,hl                   ; 2e
        push    hl
        add     hl,hl                   ; 4e
        push    hl
        add     hl,hl                   ; 8e
        push    hl
        add     hl,hl                   ; 16e
        add     hl,hl                   ; 32e
        pop     de                      ; de = 8e
        add     hl,de                   ; 40e
        pop     de                      ; de = 4e
        add     hl,de                   ; 44e
        pop     de                      ; de = 2e
        add     hl,de                   ; 46e
        ld      de,(CB_FM)
        add     hl,de
        pop     de
        ret

; ============================================================================
; エンベロープ / ピッチ進行 (C# TrackSequencer.ApplyVolumeFrame 系と同一動作)
; ============================================================================

; ---- 音量エンベロープエントリアドレス: e = 番号 -> hl = エントリ先頭
;      エントリ: [len(1) loop(1) release(1) values...]。番号はエントリ数-1 にクランプ
venv_addr:
        ld      hl,(CB_VENV)
        ld      a,(CB_VCNT)
        or      a
        ret     z                       ; テーブル無し (呼び出し側で除外済み)
        dec     a
        ld      b,a                     ; b = count-1 (最大インデックス)
        ld      a,e
        cp      b
        jr      c,va_go
        ld      a,b
va_go:
        ld      e,a
        or      a
        ret     z
va_walk:
        ld      c,(hl)                  ; c = len
        ld      b,0
        inc     bc
        inc     bc
        inc     bc                      ; bc = 3 + len
        add     hl,bc
        dec     e
        jr      nz,va_walk
        ret

; ---- ピッチエンベロープエントリアドレス: e = 番号 -> hl = エントリ先頭
;      エントリ: [len(1) loop(1) values(2B x len)]
penv_addr:
        ld      hl,(CB_PENV)
        ld      a,(CB_PCNT)
        or      a
        ret     z
        dec     a
        ld      b,a
        ld      a,e
        cp      b
        jr      c,pa_go
        ld      a,b
pa_go:
        ld      e,a
        or      a
        ret     z
pa_walk:
        ld      c,(hl)                  ; c = len
        ld      b,0
        add     hl,bc
        add     hl,bc                   ; + len*2
        inc     hl
        inc     hl                      ; + 2
        dec     e
        jr      nz,pa_walk
        ret
; ---- 音量エンベロープ 1 フレーム進行 (IX = チャンネル)
venv_frame:
        ld      a,(ix+CH_VENV)
        cp      0xFF
        ret     z
        push    af
        push    bc
        push    de
        push    hl
        ld      e,a
        call    venv_addr
        ld      c,(hl)                  ; c = len
        inc     hl
        ld      b,(hl)                  ; b = loop
        ld      a,c
        or      a
        jr      nz,vf_have
        ; 空エンベロープ: 無音固定 (C# ApplyVolumeFrame 相当)
        ld      a,15
        ld      (ix+CH_ATT),a
        call    write_att
        jr      vf_exit
vf_have:
        ; att = 15 - values[min(pos, len-1)]
        ld      a,(ix+CH_VPOS)
        cp      c
        jr      c,vf_pos
        ld      a,c
        dec     a
vf_pos:
        ld      d,0
        ld      e,a
        add     hl,de                   ; entry+1+pos
        inc     hl
        inc     hl                      ; entry+3+pos
        ld      a,15
        sub     (hl)
        ld      (ix+CH_ATT),a
        call    write_att
        ; 進行: リリース中は末尾ホールド / ノート中のみループ付き前進
        ld      a,(ix+CH_VREL)
        or      a
        jr      nz,vf_rel
        ld      a,(ix+CH_LEN)
        or      (ix+CH_LEN+1)
        jr      z,vf_exit               ; ノート外は位置を進めない
        ld      a,(ix+CH_GATE)
        or      (ix+CH_GATE+1)
        jr      z,vf_exit
        ld      a,(ix+CH_VPOS)
        inc     a
        cp      c
        jr      c,vf_set                ; pos < len-1 -> 前進
        ld      a,b                     ; pos >= len-1 -> ループ判定
        cp      c
        jr      nc,vf_exit              ; loop >= len (255 含む) -> ループなし
vf_set:
        ld      (ix+CH_VPOS),a
        jr      vf_exit
vf_rel:
        ld      a,(ix+CH_VPOS)
        inc     a
        cp      c
        jr      nc,vf_exit              ; リリース末尾でホールド
        ld      (ix+CH_VPOS),a
vf_exit:
        pop     hl
        pop     de
        pop     bc
        pop     af
        ret


; ---- ピッチエンベロープ 1 フレーム進行 (IX = チャンネル、ノート状態に依存せず常時進行)
penv_frame:
        ld      a,(ix+CH_PENV)
        cp      0xFF
        ret     z
        push    af
        push    bc
        push    de
        push    hl
        ld      e,a
        call    penv_addr
        ld      c,(hl)                  ; c = len
        inc     hl
        ld      b,(hl)                  ; b = loop
        ld      a,c
        or      a
        jr      nz,pf2_have
        xor     a
        ld      (ix+CH_PVAL),a
        ld      (ix+CH_PVAL+1),a
        jr      pf2_exit
pf2_have:
        ; pval = values[min(pos, len-1)] (符号付き 16bit)
        ld      a,(ix+CH_PPOS)
        cp      c
        jr      c,pf2_pos
        ld      a,c
        dec     a
pf2_pos:
        ld      d,0
        ld      e,a
        add     hl,de
        add     hl,de                   ; entry+1+pos*2
        inc     hl                      ; entry+2+pos*2
        ld      e,(hl)
        inc     hl
        ld      d,(hl)
        ld      (ix+CH_PVAL),e
        ld      (ix+CH_PVAL+1),d
        ; 進行 (常にループ付き前進)
        ld      a,(ix+CH_PPOS)
        inc     a
        cp      c
        jr      c,pf2_set
        ld      a,b
        cp      c
        jr      nc,pf2_exit
pf2_set:
        ld      (ix+CH_PPOS),a
pf2_exit:
        pop     hl
        pop     de
        pop     bc
        pop     af
        ret


; ---- スイープ / ディチューン / PENV を音源レジスタへ反映 (IX = チャンネル)
;      pitchUp = detune + pval + スイープ累積 (C# ApplyPitchFrame と同一。+ = 音程上昇)
pitch_frame:
        ; ノート発音中のみ (C# _noteOn 相当: len > 0 かつ gate > 0)
        ld      a,(ix+CH_LEN)
        or      (ix+CH_LEN+1)
        ret     z
        ld      a,(ix+CH_GATE)
        or      (ix+CH_GATE+1)
        ret     z
        ld      a,(ix+CH_FLAGS)
        and     0x03
        ret     nz                      ; ノイズ (bit1) はピッチ適用外
        push    bc
        push    de
        push    hl
        ; de = detune + pval (符号付き 16bit 加算)
        ld      e,(ix+CH_DETUNE)
        ld      d,(ix+CH_DETUNE+1)
        ld      a,(ix+CH_PVAL)
        add     a,e
        ld      e,a
        ld      a,(ix+CH_PVAL+1)
        adc     a,d
        ld      d,a
        ; スイープ累積 (CH_PITCH) を 1 フレーム分進める
        ld      a,(ix+CH_PITCH)
        ld      l,a
        ld      a,(ix+CH_PITCH+1)
        ld      h,a
        ld      a,(ix+CH_SWEEP)
        or      a
        jr      z,pc_nosw
        bit     7,a
        jr      nz,pc_swneg
        ; 正: 累積 += sweep
        ld      c,a
        ld      b,0
        add     hl,bc
        jr      pc_swst
pc_swneg:
        ; 負: 累積 -= |sweep| (2 の補数で絶対値)
        neg
        ld      c,a
        ld      b,0
        or      a
        sbc     hl,bc
pc_swst:
        ld      a,l
        ld      (ix+CH_PITCH),a
        ld      a,h
        ld      (ix+CH_PITCH+1),a
pc_nosw:
        add     hl,de                   ; hl = detune + pval + 累積
        ex      de,hl                   ; de = pitchUp
        bit     2,(ix+CH_FLAGS)
        jr      nz,pc_beep
        ld      a,(ix+CH_FLAGS)
        bit     3,a
        jr      nz,pc_fm
        ; DCSG tone: period = base - pitchUp (0-1023 にクランプ)
        ld      a,(ix+CH_BASEP)
        ld      l,a
        ld      a,(ix+CH_BASEP+1)
        ld      h,a
        or      a
        sbc     hl,de
        bit     7,h
        jr      z,pc_hi
        ld      hl,0                    ; 負 -> 0
        jr      pc_emit
pc_hi:
        ld      a,h
        cp      4
        jr      c,pc_emit               ; h <= 3 (= 0-1023) はそのまま
        ld      hl,1023
pc_emit:
        ex      de,hl                   ; de = period
        call    write_period
        jr      pc_exit
pc_beep:
        ; BEEP: counter = base + pitchUp (1-65535 にクランプ)
        ld      a,(ix+CH_BASEP)
        ld      l,a
        ld      a,(ix+CH_BASEP+1)
        ld      h,a
        add     hl,de
        bit     7,h
        jr      z,pc_bhi
        ld      hl,1                    ; 負 -> 1
        jr      pc_bemit
pc_bhi:
        ; 正の 16bit はすべて 65535 以下 (0 のみ 1 へ補正)
        ld      a,l
        or      a
        jr      nz,pc_bemit
        inc     hl                      ; 0 -> 1
pc_bemit:
        call    write_beep_counter
        jr      pc_exit
pc_fm:
        ; total = base + pitchUp (符号付き 16bit) -> KC / KF (C# ApplyPitchFrame FM 分岐と同一)
        ld      a,(ix+CH_BASEP)
        ld      l,a
        ld      a,(ix+CH_BASEP+1)
        ld      h,a
        add     hl,de
        call    fm_pitch_emit
pc_exit:
        pop     hl
        pop     de
        pop     bc
        ret


; ---- キーオフ処理 (C# TrackSequencer.KeyOff 相当): IX = チャンネル
;      venv 有効ならリリース区間の先頭へ移行、それ以外は無音へ
do_keyoff:
        push    af
        push    bc
        push    de
        push    hl
        xor     a
        ld      (ix+CH_PITCH),a         ; スイープ累積リセット
        ld      (ix+CH_PITCH+1),a
        ld      a,(ix+CH_FLAGS)
        bit     3,a                     ; FM?
        jr      z,dk_nofm
        ; Key Off: slot bits を 0 にしたチャンネル指定 (C# KeyOff 相当)
        ld      a,(ix+CH_PORT)
        ld      c,a
        ld      a,0x08
        call    write_fm
dk_nofm:
        ld      a,(ix+CH_VENV)
        cp      0xFF
        jr      z,dk_flat
        ld      e,a
        call    venv_addr
        ld      c,(hl)                  ; c = len
        inc     hl
        inc     hl
        ld      a,c
        or      a
        jr      z,dk_flat               ; 空エンベロープ -> リリース不可
        ld      a,(hl)                  ; a = release
        cp      c
        jr      nc,dk_flat              ; release >= len (255 含む) -> リリースなし
        ld      (ix+CH_VREL),1
        ld      (ix+CH_VPOS),a
        ld      d,0
        ld      e,a
        add     hl,de                   ; entry+2+release
        ld      a,15
        sub     (hl)
        ld      (ix+CH_ATT),a
        call    write_att
        jr      dk_exit
dk_flat:
        ld      a,15
        ld      (ix+CH_ATT),a
        call    write_att
dk_exit:
        pop     hl
        pop     de
        pop     bc
        pop     af
        ret




; ============================================================================
; 初期化
; ============================================================================
; ---- ワーククリア (CB_STATUS+1 .. ループスタック末尾)
; ---- CB_STATUS は Player 設定済みの L ループビット (bit1) を保持するためクリアしない
init_work:
        ld      hl,CB_STATUS+1
        ld      de,CB_STATUS+2
        ld      bc,LSTACK_BASE+408-CB_STATUS-2
        ld      (hl),0
        ldir
        ; 既定値: 音量 15 (最大) / att 15 (無音)
        ld      ix,CH_BLOCKS
        ld      b,TRACK_COUNT
iw_ch:
        push    bc
        ld      (ix+CH_VOLUME),15
        ld      (ix+CH_ATT),15
        ld      de,CH_TOTAL
        add     ix,de
        pop     bc
        djnz    iw_ch
        ret

; ---- 音源初期化 (PSG x2 全消音 + BEEP ゲート OFF。FM は init_ch_regs で初期化)
init_sound:
        ld      bc,0x00F2
        call    mute_psg
        ld      bc,0x00F3
        call    mute_psg
        xor     a
        ld      (VSTAT),a               ; BEEP ゲート OFF
        ret

mute_psg:
        ld      e,0x9F                  ; ch0 attenuation 15
        out     (c),e
        ld      e,0xBF                  ; ch1
        out     (c),e
        ld      e,0xDF                  ; ch2
        out     (c),e
        ld      e,0xFF                  ; noise
        out     (c),e
        ret

; ---- チャンネルワーク初期化: a = トラック番号、IX = チャンネルブロック
init_ch_regs:
        push    af
        push    bc
        push    hl
        ld      (ix+CH_LEN),0
        ld      (ix+CH_LEN+1),0
        ld      (ix+CH_GATE),0
        ld      (ix+CH_GATE+1),0
        ld      (ix+CH_ATT),15
        ld      (ix+CH_TRANS),0
        ld      (ix+CH_LDEPTH),0
        ld      (ix+CH_FLAGS),0
        ld      (ix+CH_NOISE),0
        ld      (ix+CH_HINT),0
        ld      (ix+CH_VOLUME),15
        ld      (ix+CH_VENV),0xFF       ; エンベロープ未使用
        ld      (ix+CH_PENV),0xFF
        ld      (ix+CH_SWEEP),0
        cp      3                       ; a = トラック番号 ( xor a 等で壊さないこと )
        jr      c,icr_psg1              ; 0-2
        jr      z,icr_n1                ; 3
        cp      7
        jr      c,icr_psg2              ; 4-6
        jr      z,icr_n2                ; 7
        cp      8
        jr      z,icr_beep              ; 8
        ; 9-16: FM (OPM ch = トラック番号 - 9)
        sub     9
        ld      (ix+CH_PORT),a          ; FM チャンネル番号 (0-7)
        ld      (ix+CH_DCSG),0
        ld      (ix+CH_FLAGS),8         ; bit3 = FM
        ; C# TrackSequencer.Reset (KeyOff) 相当の初期レジスタ出力:
        ; TL = att(15) * 8 = 120 を 4 op へ + Key Off レジスタ (0x08 = ch)
        call    write_att
        ld      a,(ix+CH_PORT)
        ld      c,a
        ld      a,0x08
        call    write_fm
        jr      icr_done
icr_psg1:
        ld      (ix+CH_PORT),PSG1_IO
        ld      (ix+CH_DCSG),a          ; a = 0-2
        jr      icr_done
icr_n1:
        ld      (ix+CH_PORT),PSG1_IO
        ld      (ix+CH_DCSG),3
        ld      (ix+CH_FLAGS),2
        jr      icr_done
icr_psg2:
        sub     4                       ; 4-6 -> 0-2
        ld      (ix+CH_PORT),PSG2_IO
        ld      (ix+CH_DCSG),a
        jr      icr_done
icr_n2:
        ld      (ix+CH_PORT),PSG2_IO
        ld      (ix+CH_DCSG),3
        ld      (ix+CH_FLAGS),2
        jr      icr_done
icr_beep:
        ld      (ix+CH_PORT),0
        ld      (ix+CH_DCSG),0
        ld      (ix+CH_FLAGS),4
icr_done:
        pop     hl
        pop     bc
        pop     af
        ret

; ============================================================================
; 周波数テーブル (ノート 0-127、セミトーン絶対値 A4 = 69 = 440Hz)
;   note_dctbl:    DCSG トーン period (10bit)
;   note_beep_tbl: 8253 Ch.0 カウンタ値 (16bit)
; ============================================================================
        dctbl   note_dctbl, 0, 127
        beeptbl note_beep_tbl, 0, 127

; ---- MZSD 音楽データはこの位置に配置される (統合環境が書き込む)
music_data:

