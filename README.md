# WESL Playground

A web interface to test WESL (WGSL Extended) shaders in the browser.

Website: [play.wesl-lang.dev](https://play.wesl-lang.dev) (bleeding edge is sometimes published on [wesl.thissma.fr](https://wesl.thissma.fr)

Spec Reference: [wesl-spec](https://github.com/wgsl-tooling-wg/wesl-spec)

Supported Implementations:

- 🟢 [wesl-rs][wesl-rs] (supported)
- 🟡 [wesl-js][wesl-js] (in progress #1)
- 🔴 [mew][mew] (planned #3)
- 🔴 [naga_oil][naga_oil] (planned #2)

## Building

- Install: `yarn install`
- Build: `yarn build` or `yarn dev`
- (optional) Update the package `wesl-web` locally:
  - git clone the [`wesl-rs`][wesl-rs] repository somewhere
  - install [`wasm-pack`][wasm-pack]
  - compile the package from the `wesl-rs` repo: `cargo xtask wesl-web --release` (remove `--release` for debug builds)
  - change the dependency in package.json to `file:/path/to/wesl-rs/crate/wesl-web/`

## Contributing

Contributions are welcome. Please join the [discord](https://discord.gg/Ng5FWmHuSv) server and introduce yourself first, or contact via [email](mailto:mathis.brossier@gmail.com).

## License

Except where noted (below and/or in individual files), all code in this repository is dual-licensed under either:

- MIT License ([LICENSE-MIT](LICENSE-MIT) or [http://opensource.org/licenses/MIT](http://opensource.org/licenses/MIT))
- Apache License, Version 2.0 ([LICENSE-APACHE](LICENSE-APACHE) or [http://www.apache.org/licenses/LICENSE-2.0](http://www.apache.org/licenses/LICENSE-2.0))

at your option.

### Your contributions

Unless you explicitly state otherwise,
any contribution intentionally submitted for inclusion in the work by you,
as defined in the Apache-2.0 license,
shall be dual licensed as above,
without any additional terms or conditions.

[wesl-rs]: https://github.com/wgsl-tooling-wg/wesl-rs
[wesl-js]: https://github.com/wgsl-tooling-wg/wesl-js
[mew]: https://github.com/ncthbrt/mew
[naga_oil]: https://github.com/bevyengine/naga_oil
[wasm-pack]: https://rustwasm.github.io/wasm-pack/
