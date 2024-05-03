#![feature(future_join)]
#![feature(min_specialization)]
#![feature(arbitrary_self_types)]

use std::{
    io::{stdout, Write},
    time::Instant,
};

use anyhow::Result;
use next_api::{
    project::{ProjectContainer, ProjectOptions},
    route::{Endpoint, Route},
};
use turbo_tasks::TurboTasks;
use turbo_tasks_malloc::TurboMalloc;
use turbopack_binding::turbo::tasks_memory::MemoryBackend;

#[global_allocator]
static ALLOC: turbo_tasks_malloc::TurboMalloc = turbo_tasks_malloc::TurboMalloc;

fn main() {
    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .on_thread_stop(|| {
            TurboMalloc::thread_stop();
        })
        .build()
        .unwrap()
        .block_on(async {
            let tt = TurboTasks::new(MemoryBackend::new(usize::MAX));
            let r = tt.run_once(main_inner()).await;

            let start = Instant::now();
            drop(tt);
            println!("drop {:?}", start.elapsed());

            r
        })
        .unwrap();
}

async fn main_inner() -> Result<()> {
    register();

    let mut file = std::fs::File::open("project_options.json")?;
    let data: ProjectOptions = serde_json::from_reader(&mut file).unwrap();

    let options = ProjectOptions { ..data };

    let start = Instant::now();
    let project = ProjectContainer::new(options);
    println!("ProjectContainer::new {:?}", start.elapsed());

    let start = Instant::now();
    let entrypoints = project.entrypoints().await?;
    println!("project.entrypoints {:?}", start.elapsed());

    // TODO run 10 in parallel
    // select 100 by pseudo random
    let routes = entrypoints
        .routes
        .iter()
        .filter(|(name, _)| name.contains("home"))
        .collect::<Vec<_>>();
    for (name, route) in routes {
        let start = Instant::now();
        print!("{name}");
        stdout().flush().unwrap();
        match route {
            Route::Page {
                html_endpoint,
                data_endpoint: _,
            } => {
                html_endpoint.write_to_disk().await?;
            }
            Route::PageApi { endpoint } => {
                endpoint.write_to_disk().await?;
            }
            Route::AppPage(routes) => {
                for route in routes {
                    route.html_endpoint.write_to_disk().await?;
                }
            }
            Route::AppRoute {
                original_name: _,
                endpoint,
            } => {
                endpoint.write_to_disk().await?;
            }
            Route::Conflict => {
                println!("WARN: conflict {}", name);
            }
        }
        println!(" {:?}", start.elapsed());
    }

    Ok(())
}

fn register() {
    next_api::register();
    include!(concat!(env!("OUT_DIR"), "/register.rs"));
}
