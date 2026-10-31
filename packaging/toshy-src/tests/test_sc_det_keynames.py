#!/usr/bin/env python3
"""
tests/test_sc_det_keynames.py

Focused tests for the shortcut_detect key name layer: every translation
table value must be a real xwaykeyz Key member, the GTK/COSMIC keysym
lookup, the KDE (Qt PortableText) lookup including Plasma 5 vs 6 Launch
key numbering, and the result-layer validate_combos() downgrade.

The table-membership group needs xwaykeyz importable (the Toshy venv
python has it); it reports a loud failure rather than skipping if not.

Runnable standalone (accumulates a score in main) and collectable by
pytest (bool-returning test functions).
"""
__version__ = '20260831'

import os
import sys
import types

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))

# Stub sibling deps BEFORE package imports (the package __init__ pulls
# sc_det_fallback -> proc_launcher -> xwaykeyz logger).
_fake_proc_launcher = types.ModuleType('toshy_common.proc_launcher')
_fake_proc_launcher.launch_detached = lambda args, **kwargs: False
sys.modules['toshy_common.proc_launcher'] = _fake_proc_launcher
_fake_logger = types.ModuleType('toshy_common.logger')
_fake_logger.debug = lambda *args, **kwargs: None
_fake_logger.error = lambda *args, **kwargs: None
_fake_logger.VERBOSE = False
sys.modules['toshy_common.logger'] = _fake_logger

from toshy_common.shortcut_detect import (
    STATUS_RESOLVED,
    STATUS_UNRESOLVED,
    SlotResult,
    keyname_from_kde_name,
    keyname_from_keysym,
    normalize_gtk_accel,
    normalize_kde_accel,
    validate_combos,
)
from toshy_common.shortcut_detect.sc_det_keynames import (
    KDE_KEYNAME_TO_KEYNAME_DCT,
    KDE_PUNCT_TO_KEYNAME_DCT,
    KEYSYM_TO_KEYNAME_DCT,
)


def _check_cases(label_str: str, case_fn, cases_lst: 'list[tuple]') -> bool:
    all_ok = True
    print(f'\n--- {label_str} ---')
    for input_val, expected_val in cases_lst:
        actual_val = case_fn(input_val)
        ok = actual_val == expected_val
        all_ok = all_ok and ok
        marker = 'ok  ' if ok else 'FAIL'
        print(f'  [{marker}] {input_val!r:40} -> {actual_val!r}  (expected {expected_val!r})')
    return all_ok


def test_table_values_are_real_keys() -> bool:
    """Every value in every table must be a member of the xwaykeyz Key
    enum after the combo parser's upper-casing. This is what makes the
    allowlist in toshy_common trustworthy without importing xwaykeyz
    from library code."""
    print('\n--- table values exist in xwaykeyz Key enum ---')
    try:
        from xwaykeyz.models.key import Key
    except ImportError:
        print('  [FAIL] xwaykeyz not importable; run this with the Toshy venv python '
                '(or add the xwaykeyz checkout to PYTHONPATH)')
        return False

    all_ok = True
    tables_lst = [
        ('KEYSYM_TO_KEYNAME_DCT',        KEYSYM_TO_KEYNAME_DCT),
        ('KDE_KEYNAME_TO_KEYNAME_DCT',   KDE_KEYNAME_TO_KEYNAME_DCT),
        ('KDE_PUNCT_TO_KEYNAME_DCT',     KDE_PUNCT_TO_KEYNAME_DCT),
    ]
    for table_name, table_dct in tables_lst:
        bad_lst = []
        for de_name, keyname in table_dct.items():
            if keyname in ('Super', 'RSuper'):
                continue        # modifier names, emitted as bare taps, not via Key[]
            try:
                Key[keyname.upper()]
            except KeyError:
                bad_lst.append((de_name, keyname))
        ok = not bad_lst
        all_ok = all_ok and ok
        marker = 'ok  ' if ok else 'FAIL'
        print(f'  [{marker}] {table_name}: {len(table_dct)} entries, {len(bad_lst)} bad')
        for de_name, keyname in bad_lst:
            print(f'           {de_name!r} -> {keyname!r} is not a Key member')
    return all_ok


def test_keysym_lookup() -> bool:
    cases_lst = [
        # The reported crash: ThinkPad dedicated key bound to screenshots.
        ('Launch9',                     'F18'),
        ('XF86Launch9',                 'F18'),
        ('Launch1',                     'Prog1'),
        ('LaunchA',                     'Scale'),
        ('Print',                       'Print'),
        ('Escape',                      'Esc'),
        ('Return',                      'Enter'),
        ('space',                       'Space'),
        ('period',                      'Dot'),
        ('bracketleft',                 'Left_Brace'),
        ('Prior',                       'Page_Up'),
        ('Page_Down',                   'Page_Down'),
        ('AudioMute',                   'Mute'),
        ('XF86AudioRaiseVolume',        'VolumeUp'),
        ('MonBrightnessUp',             'BrightnessUp'),
        ('AudioMicMute',                'F20'),         # dedicated code is > 247
        ('KP_Enter',                    'KPEnter'),
        ('Super_L',                     'Super'),
        ('xf86audiomute',               'Mute'),        # case-insensitive fallback
        # Passthrough classes.
        ('p',                           'p'),
        ('P',                           'P'),
        ('7',                           '7'),
        ('F1',                          'F1'),
        ('F24',                         'F24'),
        # Refused: no known emittable Key.
        ('F25',                         None),
        ('Sys_Req',                     None),          # shifted level of Print
        ('ISO_Next_Group',              None),
        ('Bogus',                       None),
        ('',                            None),
    ]
    return _check_cases('keysym -> Key name', keyname_from_keysym, cases_lst)


def test_kde_name_lookup() -> bool:
    all_ok = True
    cases_lst = [
        ('Print',                       'Print'),
        ('Esc',                         'Esc'),
        ('Return',                      'Enter'),
        ('Ins',                         'Insert'),
        ('Del',                         'Delete'),
        ('PgUp',                        'Page_Up'),
        ('PgDown',                      'Page_Down'),
        ('Volume Up',                   'VolumeUp'),
        ('Volume Down',                 'VolumeDown'),
        ('Monitor Brightness Up',       'BrightnessUp'),
        ('Media Play',                  'PlayPause'),
        ('Launch Mail',                 'Mail'),
        ('Browser',                     'File'),
        ('Touchpad Toggle',             'F21'),
        (',',                           'Comma'),
        ('`',                           'Grave'),
        ('F12',                         'F12'),         # falls through to keysym lookup
        ('Home',                        'Home'),
        ('Bogus Key',                   None),
        ('',                            None),
    ]
    all_ok &= _check_cases('KDE name -> Key name (version-independent)',
                            keyname_from_kde_name, cases_lst)

    print('\n--- KDE Launch (X) numbering by Plasma major ---')
    launch_cases_lst = [
        ('Launch (9)', 6,   'F18'),         # Qt 6: XF86Launch9
        ('Launch (9)', 5,   'F16'),         # Qt 5: XF86Launch7
        ('Launch (B)', 5,   'F18'),         # Qt 5: XF86Launch9
        ('Launch (0)', 5,   'Computer'),    # Qt 5: XF86MyComputer
        ('Launch (1)', 5,   'Calc'),        # Qt 5: XF86Calculator
        ('Launch (0)', 6,   None),          # XF86Launch0 has no evdev code
        ('Launch (9)', '6', 'F18'),         # digit string accepted
    ]
    for name_str, ver, expected in launch_cases_lst:
        actual = keyname_from_kde_name(name_str, ver)
        ok = actual == expected
        all_ok = all_ok and ok
        marker = 'ok  ' if ok else 'FAIL'
        print(f'  [{marker}] {name_str!r} plasma={ver!r:4} -> {actual!r}  (expected {expected!r})')

    # Environment fallback when the caller has no version.
    saved_env = os.environ.get('KDE_SESSION_VERSION')
    try:
        os.environ['KDE_SESSION_VERSION'] = '5'
        env5 = keyname_from_kde_name('Launch (9)')
        os.environ.pop('KDE_SESSION_VERSION')
        env_none = keyname_from_kde_name('Launch (9)')
    finally:
        if saved_env is None:
            os.environ.pop('KDE_SESSION_VERSION', None)
        else:
            os.environ['KDE_SESSION_VERSION'] = saved_env
    ok = env5 == 'F16' and env_none == 'F18'
    all_ok = all_ok and ok
    marker = 'ok  ' if ok else 'FAIL'
    print(f'  [{marker}] env fallback: KDE_SESSION_VERSION=5 -> {env5!r}, unset -> {env_none!r}')
    return all_ok


def test_accel_end_to_end() -> bool:
    all_ok = True
    all_ok &= _check_cases('GTK accel with translated key names', normalize_gtk_accel, [
        ('<Shift>Launch9',              'Shift-F18'),
        ('<Alt>Launch9',                'Alt-F18'),
        ('Launch9',                     'F18'),
        ('<Super>Page_Up',              'Super-Page_Up'),
        ('XF86MonBrightnessUp',         'BrightnessUp'),
        ('<Super>Bogus',                None),
    ])
    all_ok &= _check_cases('KDE accel with translated key names (Plasma 6 default)',
                            normalize_kde_accel, [
        ('Meta+Shift+Launch (9)',       'Shift-Super-F18'),
        ('Volume Down',                 'VolumeDown'),
        ('Meta+,',                      'Super-Comma'),
        ('Ctrl++',                      None),
        ('Meta+Bogus Key',              None),
    ])
    print('\n--- KDE accel with explicit Plasma 5 ---')
    actual = normalize_kde_accel('Shift+Launch (B)', 5)
    ok = actual == 'Shift-F18'
    all_ok = all_ok and ok
    print(f"  [{'ok  ' if ok else 'FAIL'}] 'Shift+Launch (B)' plasma=5 -> {actual!r}  (expected 'Shift-F18')")
    return all_ok


def test_validate_combos_downgrade() -> bool:
    """A stand-in for the keymapper's C(): rejects any key token that is
    not in a small accepted set, the way Key[...] raises KeyError."""
    accepted_set = {'PRINT', 'F18', 'SPACE'}

    def fake_combo_fn(combo_str):
        key_token = combo_str.rsplit('-', 1)[-1].upper()
        if key_token not in accepted_set:
            raise KeyError(key_token)
        return combo_str

    results_dct = {
        'good':         SlotResult(STATUS_RESOLVED, combo='Shift-Print', source='live_settings'),
        'bad':          SlotResult(STATUS_RESOLVED, combo='Shift-Launch9', source='live_settings',
                                    raw='<Shift>Launch9'),
        'bare_mod':     SlotResult(STATUS_RESOLVED, combo='Super', source='live_settings'),
        'not_resolved': SlotResult(STATUS_UNRESOLVED),
    }
    validate_combos(results_dct, fake_combo_fn, 'TEST')

    print('\n--- validate_combos downgrade ---')
    checks_lst = [
        ('accepted combo stays resolved',
            results_dct['good'].status == STATUS_RESOLVED),
        ('rejected combo downgraded to unresolved',
            results_dct['bad'].status == STATUS_UNRESOLVED),
        ('rejected combo keeps raw for diagnostics',
            results_dct['bad'].raw == '<Shift>Launch9'),
        ('rejected combo note names the string',
            'Shift-Launch9' in results_dct['bad'].note),
        ('bare modifier combo is not run through C()',
            results_dct['bare_mod'].status == STATUS_RESOLVED),
        ('unresolved slot untouched',
            results_dct['not_resolved'].status == STATUS_UNRESOLVED),
    ]
    all_ok = True
    for label_str, ok in checks_lst:
        all_ok = all_ok and ok
        print(f"  [{'ok  ' if ok else 'FAIL'}] {label_str}")
    return all_ok


def main():
    results_lst = [
        test_table_values_are_real_keys(),
        test_keysym_lookup(),
        test_kde_name_lookup(),
        test_accel_end_to_end(),
        test_validate_combos_downgrade(),
    ]
    passed_cnt = sum(1 for result in results_lst if result)
    print(f'\nScore: {passed_cnt}/{len(results_lst)} test groups passed')
    return 0 if passed_cnt == len(results_lst) else 1


if __name__ == '__main__':
    sys.exit(main())

# End of file #
