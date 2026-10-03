use anchor_lang::prelude::*;
declare_id!("4bjaHzaDTYxKiJ7fTMWTyMbHkQtG8t1rc8nNcHHk4iKd");
declare_program!(dynamic_bonding_curve);
#[program]
pub mod curvebook_router {
    use super::*;
    pub fn noop(_ctx: Context<Noop>) -> Result<()> { Ok(()) }
}
#[derive(Accounts)]
pub struct Noop {}
